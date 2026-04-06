/* ═══════════════════════════════════════════════════════════════════════════
   MindBridge — Client-side Application Logic
   Handles SSE streaming, chat rendering, debug panel updates.
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const $messages      = document.getElementById("chat-messages");
  const $welcomeCard   = document.getElementById("welcome-card");
  const $form          = document.getElementById("chat-form");
  const $input         = document.getElementById("chat-input");
  const $btnSend       = document.getElementById("btn-send");
  const $btnNewChat    = document.getElementById("btn-new-chat");
  const $btnDebug      = document.getElementById("btn-toggle-debug");
  const $btnSidebar    = document.getElementById("btn-toggle-sidebar");
  const $debugPanel    = document.getElementById("debug-panel");
  const $historyPanel  = document.getElementById("history-panel");
  const $historyList   = document.getElementById("history-list");
  const $safetyBanner  = document.getElementById("safety-banner");

  // Debug sub-elements
  const $emotionLabel  = document.getElementById("emotion-label");
  const $emotionBar    = document.getElementById("emotion-bar");
  const $emotionConf   = document.getElementById("emotion-confidence");
  const $emotionKws    = document.getElementById("emotion-keywords");
  const $safetyStatus  = document.getElementById("safety-status");
  const $safetyDetails = document.getElementById("safety-details");
  const $entityList    = document.getElementById("entity-list");
  const $ragList       = document.getElementById("rag-list");
  const $thinkStream   = document.getElementById("thinking-stream");
  const $reasonToggle  = document.getElementById("toggle-reasoning");
  const $reasonOffHint = document.getElementById("reasoning-off-hint");
  const $sessionId     = document.getElementById("session-id-display");
  const $turnCount     = document.getElementById("turn-count");
  const $prefDisplay   = document.getElementById("preferences-display");

  // ─── State ─────────────────────────────────────────────────────────────────
  let sessionId = localStorage.getItem("mb_session_id") || null;
  let isStreaming = false;
  let reasoningVisible = localStorage.getItem("mb_reasoning_on") === "true"; // default OFF
  let sidebarVisible = localStorage.getItem("mb_sidebar_on") === "true"; // default off

  // ─── Debug panel toggle ────────────────────────────────────────────────────
  $btnDebug.addEventListener("click", () => {
    const opening = $debugPanel.classList.contains("hidden");
    $debugPanel.classList.toggle("hidden");
    $btnDebug.classList.toggle("active");
    if (opening) {
      // Restore session info display if we have a session
      if (sessionId) {
        $sessionId.textContent = sessionId.slice(0, 12) + "…";
      }
    }
  });

  // ─── Reasoning toggle (persisted) ──────────────────────────────────────────
  function applyReasoningVisibility() {
    $thinkStream.style.display = reasoningVisible ? "" : "none";
    $reasonOffHint.style.display = reasoningVisible ? "none" : "";
    $reasonToggle.checked = reasoningVisible;
  }

  $reasonToggle.addEventListener("change", () => {
    reasoningVisible = $reasonToggle.checked;
    localStorage.setItem("mb_reasoning_on", reasoningVisible ? "true" : "false");
    applyReasoningVisibility();
  });

  applyReasoningVisibility();

  // ─── Sidebar toggle (persisted) ────────────────────────────────────────────
  function applySidebarVisibility() {
    $historyPanel.classList.toggle("hidden", !sidebarVisible);
    $btnSidebar.classList.toggle("active", sidebarVisible);
  }

  $btnSidebar.addEventListener("click", () => {
    sidebarVisible = !sidebarVisible;
    localStorage.setItem("mb_sidebar_on", sidebarVisible ? "true" : "false");
    applySidebarVisibility();
    if (sidebarVisible) refreshHistory();
  });

  applySidebarVisibility();

  // ─── New Chat ──────────────────────────────────────────────────────────────
  $btnNewChat.addEventListener("click", async () => {
    if (isStreaming) return;
    sessionId = null;
    localStorage.removeItem("mb_session_id");
    clearChat();
    refreshHistory();
  });

  // ─── Hint chips ────────────────────────────────────────────────────────────
  document.querySelectorAll(".hint-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const hint = chip.dataset.hint;
      if (hint) {
        $input.value = hint;
        updateSendButton();
        $input.focus();
      }
    });
  });

  // ─── Input handling ────────────────────────────────────────────────────────
  $input.addEventListener("input", () => { autoGrow(); updateSendButton(); });

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ($input.value.trim() && !isStreaming) $form.requestSubmit();
    }
  });

  $form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage($input.value.trim());
  });

  function autoGrow() {
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 140) + "px";
  }

  function updateSendButton() {
    $btnSend.disabled = !$input.value.trim() || isStreaming;
  }

  // ─── Send message ──────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text || isStreaming) return;
    isStreaming = true;
    updateSendButton();

    // Hide welcome
    if ($welcomeCard) $welcomeCard.style.display = "none";

    // Add user bubble
    appendMessage("user", text);
    $input.value = "";
    $input.style.height = "auto";

    // Clear previous debug state
    $thinkStream.textContent = "";
    $safetyBanner.classList.add("hidden");

    // Add assistant placeholder with typing indicator
    const assistantBubble = appendMessage("assistant", null, true);
    const bodyEl = assistantBubble.querySelector(".msg-body");

    let inlineThinkEl = null;
    let inlineThinkContent = null;
    let thinkingText = "";
    let removedTyping = false;
    let thinkingFinalized = false;

    function ensureInlineThink() {
      if (inlineThinkEl || !reasoningVisible) return;
      // Remove typing indicator to make room
      if (!removedTyping) {
        bodyEl.innerHTML = "";
        removedTyping = true;
      }
      const details = document.createElement("details");
      details.className = "msg-thinking is-streaming";
      details.open = true;
      details.innerHTML = `
        <summary>
          <span class="think-spinner"></span>
          Thinking…
        </summary>
        <div class="msg-thinking-content"></div>
      `;
      bodyEl.appendChild(details);
      inlineThinkEl = details;
      inlineThinkContent = details.querySelector(".msg-thinking-content");
    }

    function finalizeInlineThink() {
      if (!inlineThinkEl) return;
      inlineThinkEl.classList.remove("is-streaming");
      const summary = inlineThinkEl.querySelector("summary");
      const tokenCount = thinkingText.split(/\s+/).filter(Boolean).length;
      summary.innerHTML = `Thought for ${tokenCount} tokens <span class="msg-thinking-badge">${tokenCount} tokens</span>`;
      inlineThinkEl.open = false; // collapse after thinking is done
    }

    // Start SSE
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        bodyEl.textContent = `Error: ${err.error || resp.statusText}`;
        isStreaming = false;
        updateSendButton();
        return;
      }

      // Parse SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentSoFar = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line in buffer

        let eventType = null;

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            handleSSE(eventType, data);
            eventType = null;
          }
        }
      }

      // Finalize — stream done
      function handleSSE(event, data) {
        switch (event) {
          case "session_id": {
            const obj = safeParse(data);
            if (obj?.session_id) {
              sessionId = obj.session_id;
              localStorage.setItem("mb_session_id", sessionId);
              $sessionId.textContent = sessionId.slice(0, 12) + "…";
            }
            break;
          }

          case "safety": {
            const s = safeParse(data);
            updateSafety(s);
            break;
          }

          case "thinking": {
            // Debug panel
            $thinkStream.textContent += data;
            $thinkStream.scrollTop = $thinkStream.scrollHeight;
            // Inline bubble
            thinkingText += data;
            ensureInlineThink();
            if (inlineThinkContent) {
              inlineThinkContent.textContent = thinkingText;
              inlineThinkContent.scrollTop = inlineThinkContent.scrollHeight;
            }
            scrollToBottom();
            break;
          }

          case "content": {
            // Finalize thinking block on first content token
            if (inlineThinkEl && !thinkingFinalized) {
              finalizeInlineThink();
              thinkingFinalized = true;
            }
            if (!removedTyping) {
              if (!inlineThinkEl) {
                bodyEl.innerHTML = "";
              }
              removedTyping = true;
            }
            contentSoFar += data;
            // Rebuild: keep thinking block + render content after it
            const thinkHTML = inlineThinkEl ? inlineThinkEl.outerHTML : "";
            bodyEl.innerHTML = thinkHTML + renderMarkdown(contentSoFar);
            // Re-attach the live reference
            if (inlineThinkEl) {
              inlineThinkEl = bodyEl.querySelector(".msg-thinking");
              inlineThinkContent = inlineThinkEl?.querySelector(".msg-thinking-content");
            }
            bodyEl.classList.add("streaming-cursor");
            scrollToBottom();
            break;
          }

          case "metadata": {
            bodyEl.classList.remove("streaming-cursor");
            const meta = safeParse(data);
            if (meta) updateDebugPanel(meta);
            break;
          }
        }
      }

      // If no content arrived at all, show fallback
      if (!contentSoFar.trim()) {
        bodyEl.textContent = "I'm here for you. Could you tell me more about what you're feeling?";
      }
      bodyEl.classList.remove("streaming-cursor");

    } catch (err) {
      bodyEl.textContent = `Connection error: ${err.message}. Make sure the backend & LM Studio are running.`;
      console.error(err);
    }

    isStreaming = false;
    updateSendButton();
    scrollToBottom();
    refreshHistory();
  }

  // ─── History Sidebar ────────────────────────────────────────────────────────
  async function refreshHistory() {
    try {
      const resp = await fetch("/api/sessions");
      if (!resp.ok) return;
      const sessions = await resp.json();

      if (sessions.length === 0) {
        $historyList.innerHTML = `<p class="empty-state">No conversations yet</p>`;
        return;
      }

      $historyList.innerHTML = sessions.map(s => {
        const isActive = s.session_id === sessionId;
        const timeAgo = formatTimeAgo(s.last_active);
        return `
          <div class="history-item${isActive ? ' active' : ''}" data-sid="${esc(s.session_id)}">
            <div class="history-item-content">
              <div class="history-item-title">${esc(s.title)}</div>
              <div class="history-item-meta">
                <span>${s.turn_count} turn${s.turn_count !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>${timeAgo}</span>
                ${s.emotion !== 'neutral' ? `<span class="history-item-emotion">${esc(s.emotion)}</span>` : ''}
              </div>
            </div>
            <button class="history-item-delete" data-delete="${esc(s.session_id)}" title="Delete conversation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>
        `;
      }).join("");

      // Click to load session
      $historyList.querySelectorAll(".history-item").forEach(item => {
        item.addEventListener("click", (e) => {
          if (e.target.closest(".history-item-delete")) return;
          const sid = item.dataset.sid;
          if (sid && sid !== sessionId && !isStreaming) {
            loadSession(sid);
          }
        });
      });

      // Delete buttons
      $historyList.querySelectorAll(".history-item-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const sid = btn.dataset.delete;
          if (!sid) return;
          await deleteSession(sid);
        });
      });

    } catch (_) { /* ignore */ }
  }

  async function loadSession(sid) {
    try {
      const resp = await fetch(`/api/sessions/${sid}`);
      if (!resp.ok) return;
      const data = await resp.json();

      sessionId = sid;
      localStorage.setItem("mb_session_id", sid);
      $sessionId.textContent = sid.slice(0, 12) + "…";

      // Clear and render messages
      $messages.innerHTML = "";
      if ($welcomeCard) {
        $messages.appendChild($welcomeCard);
        $welcomeCard.style.display = "none";
      }
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => appendMessage(m.role, m.content));
      }

      // Update debug panel
      $turnCount.textContent = data.turn_count || 0;
      if (data.entities && Object.keys(data.entities).length) {
        $entityList.innerHTML = Object.entries(data.entities)
          .map(([k, v]) => `<div class="entity-row"><span class="entity-key">${esc(k)}</span><span class="entity-val">${esc(v)}</span></div>`)
          .join("");
      } else {
        $entityList.innerHTML = `<p class="empty-state">No entities detected yet</p>`;
      }
      if (data.emotion_state) {
        $emotionLabel.textContent = data.emotion_state;
        $emotionBar.style.width = (data.emotion_confidence || 0) + "%";
        $emotionConf.textContent = (data.emotion_confidence || 0) + "%";
      }
      if (data.preferences && data.preferences.length) {
        $prefDisplay.textContent = data.preferences.join(", ");
      } else {
        $prefDisplay.textContent = "—";
      }

      scrollToBottom();
      refreshHistory(); // update active highlight
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }

  async function deleteSession(sid) {
    try {
      await fetch(`/api/sessions/${sid}`, { method: "DELETE" });
      // If deleting current session, start fresh
      if (sid === sessionId) {
        sessionId = null;
        localStorage.removeItem("mb_session_id");
        clearChat();
      }
      refreshHistory();
    } catch (_) { /* ignore */ }
  }

  function formatTimeAgo(timestamp) {
    const diff = (Date.now() / 1000) - timestamp;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  // ─── DOM helpers ───────────────────────────────────────────────────────────
  function appendMessage(role, text, isPlaceholder = false) {
    const div = document.createElement("div");
    div.className = `msg msg-${role}`;

    const avatarIcon = role === "user" ? "🧑" : "🧠";
    const body = isPlaceholder
      ? `<div class="typing-indicator"><span></span><span></span><span></span></div>`
      : renderMarkdown(text || "");

    div.innerHTML = `
      <div class="msg-avatar">${avatarIcon}</div>
      <div class="msg-body">${body}</div>
    `;

    $messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      $messages.scrollTop = $messages.scrollHeight;
    });
  }

  function clearChat() {
    // Keep welcome card, remove messages
    $messages.innerHTML = "";
    const welcomeClone = createWelcomeCard();
    $messages.appendChild(welcomeClone);

    // Reset debug
    $emotionLabel.textContent = "neutral";
    $emotionBar.style.width = "0%";
    $emotionConf.textContent = "0%";
    $emotionKws.innerHTML = "";
    $safetyStatus.innerHTML = `<span class="safety-dot safe"></span><span>No flags</span>`;
    $safetyDetails.classList.add("hidden");
    $entityList.innerHTML = `<p class="empty-state">No entities detected yet</p>`;
    $ragList.innerHTML = `<p class="empty-state">No retrieval performed yet</p>`;
    $thinkStream.textContent = "Waiting for inference…";
    $sessionId.textContent = "—";
    $turnCount.textContent = "0";
    $prefDisplay.textContent = "—";
    $safetyBanner.classList.add("hidden");
  }

  function createWelcomeCard() {
    const div = document.createElement("div");
    div.className = "welcome-card";
    div.id = "welcome-card";
    div.innerHTML = `
      <div class="welcome-icon">✨</div>
      <h2>Welcome to MindBridge</h2>
      <p>I'm here to listen and support you. Share what's on your mind — everything stays between us.</p>
      <div class="welcome-hints">
        <button class="hint-chip" data-hint="I've been feeling really overwhelmed lately">💭 Feeling overwhelmed</button>
        <button class="hint-chip" data-hint="I can't sleep because my mind won't stop racing">😟 Racing thoughts</button>
        <button class="hint-chip" data-hint="I feel like nobody really understands me">🫂 Feeling alone</button>
      </div>
    `;
    // Re-attach hint listeners
    div.querySelectorAll(".hint-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const hint = chip.dataset.hint;
        if (hint) { $input.value = hint; updateSendButton(); $input.focus(); }
      });
    });
    return div;
  }

  // ─── Debug panel updates ───────────────────────────────────────────────────
  function updateSafety(s) {
    if (!s) return;

    if (s.risk_level === "high") {
      $safetyBanner.classList.remove("hidden", "warn");
      $safetyBanner.querySelector(".safety-text").textContent =
        "⚠ High-risk content detected — safety protocol activated";
    } else if (s.risk_level === "medium") {
      $safetyBanner.classList.remove("hidden");
      $safetyBanner.classList.add("warn");
      $safetyBanner.querySelector(".safety-text").textContent =
        "Moderate distress signals detected — monitoring closely";
    } else {
      $safetyBanner.classList.add("hidden");
    }

    // Debug panel safety card
    const dotClass = s.risk_level === "high" ? "danger" : s.risk_level === "medium" ? "warn" : "safe";
    const label = s.risk_level === "none" ? "No flags" : `${s.risk_level.toUpperCase()} — ${s.matched.join(", ")}`;
    $safetyStatus.innerHTML = `<span class="safety-dot ${dotClass}"></span><span>${label}</span>`;

    if (s.is_flagged) {
      $safetyDetails.textContent = `Matched: ${s.matched.join(", ")}`;
      $safetyDetails.classList.remove("hidden");
    } else {
      $safetyDetails.classList.add("hidden");
    }
  }

  function updateDebugPanel(meta) {
    // Emotion
    if (meta.emotion) {
      $emotionLabel.textContent = meta.emotion.label;
      $emotionBar.style.width = meta.emotion.confidence + "%";
      $emotionConf.textContent = meta.emotion.confidence + "%";

      $emotionKws.innerHTML = (meta.emotion.keywords_matched || [])
        .map(kw => `<span class="emotion-kw">${esc(kw)}</span>`)
        .join("");
    }

    // Entities
    if (meta.entities && Object.keys(meta.entities).length > 0) {
      $entityList.innerHTML = Object.entries(meta.entities)
        .map(([k, v]) => `
          <div class="entity-row">
            <span class="entity-key">${esc(k)}</span>
            <span class="entity-val">${esc(v)}</span>
          </div>
        `).join("");
    }

    // RAG Sources
    if (meta.rag_sources && meta.rag_sources.length > 0) {
      $ragList.innerHTML = meta.rag_sources.map(r => `
        <div class="rag-card">
          <span class="rag-source">${esc(r.source)}</span>
          <span class="rag-distance">dist: ${r.distance}</span>
          <p class="rag-snippet">${esc(r.snippet)}</p>
        </div>
      `).join("");
    }

    // Session info
    if (meta.turn_count !== undefined) {
      $turnCount.textContent = meta.turn_count;
    }
    if (meta.preferences && meta.preferences.length > 0) {
      $prefDisplay.textContent = meta.preferences.join(", ");
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────
  function safeParse(str) {
    try { return JSON.parse(str); } catch { return null; }
  }

  function esc(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }

  /** Minimal markdown → HTML (bold, italic, code, links, line breaks). */
  function renderMarkdown(text) {
    if (!text) return "";
    let html = esc(text);
    // code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // line breaks
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  const $loadingOverlay = document.getElementById("loading-overlay");
  const $loadingStatus  = document.getElementById("loading-status");
  let backendReady = false;

  updateSendButton();

  // Poll /api/health until backend models are loaded
  async function pollHealth() {
    try {
      const resp = await fetch("/api/health");
      if (resp.ok) {
        const data = await resp.json();
        $loadingStatus.textContent = data.status;
        if (data.ready) {
          backendReady = true;
          $loadingOverlay.classList.add("fade-out");
          // Remove from DOM after transition
          setTimeout(() => $loadingOverlay.remove(), 600);
          $input.disabled = false;
          $input.placeholder = "Type your message…";
          updateSendButton();
          refreshHistory();
          return; // stop polling
        }
      }
    } catch (_) {
      $loadingStatus.textContent = "Connecting to server…";
    }
    setTimeout(pollHealth, 800);
  }

  // Disable input while models load
  $input.disabled = true;
  $input.placeholder = "Waiting for models to load…";
  pollHealth();

  // If we have a previous session, try to restore it
  if (sessionId) {
    $sessionId.textContent = sessionId.slice(0, 12) + "…";
    fetch(`/api/sessions/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !data.messages || data.messages.length === 0) return;
        // Hide welcome, render history
        if ($welcomeCard) $welcomeCard.style.display = "none";
        data.messages.forEach(m => appendMessage(m.role, m.content));
        // Update debug
        $turnCount.textContent = data.turn_count || 0;
        if (data.entities && Object.keys(data.entities).length) {
          $entityList.innerHTML = Object.entries(data.entities)
            .map(([k, v]) => `<div class="entity-row"><span class="entity-key">${esc(k)}</span><span class="entity-val">${esc(v)}</span></div>`)
            .join("");
        }
        if (data.emotion_state) {
          $emotionLabel.textContent = data.emotion_state;
          $emotionBar.style.width = (data.emotion_confidence || 0) + "%";
          $emotionConf.textContent = (data.emotion_confidence || 0) + "%";
        }
        if (data.preferences && data.preferences.length) {
          $prefDisplay.textContent = data.preferences.join(", ");
        }
        scrollToBottom();
      })
      .catch(() => { /* session expired, start fresh */ });
  }
})();
