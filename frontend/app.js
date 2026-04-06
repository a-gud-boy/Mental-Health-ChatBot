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
  const $debugPanel    = document.getElementById("debug-panel");
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

  // ─── New Chat ──────────────────────────────────────────────────────────────
  $btnNewChat.addEventListener("click", async () => {
    if (isStreaming) return;
    if (sessionId) {
      try { await fetch("/api/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch (_) { /* ignore */ }
    }
    sessionId = null;
    localStorage.removeItem("mb_session_id");
    clearChat();
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
      let removedTyping = false;

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
            $thinkStream.textContent += data;
            $thinkStream.scrollTop = $thinkStream.scrollHeight;
            break;
          }

          case "content": {
            if (!removedTyping) {
              bodyEl.innerHTML = "";
              removedTyping = true;
            }
            contentSoFar += data;
            bodyEl.innerHTML = renderMarkdown(contentSoFar);
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
