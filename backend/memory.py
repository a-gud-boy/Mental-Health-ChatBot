"""
Stateful session memory — maintains conversation history, extracted entities,
user preferences, and heuristic emotion state across turns.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Dict, List

from backend.config import MAX_CONTEXT_TURNS

# ─── Emotion lexicon (keyword → emotion label) ───────────────────────────────
_EMOTION_LEXICON: Dict[str, List[str]] = {
    "anxiety": [
        "anxious", "anxiety", "nervous", "worried", "panic", "restless",
        "overthinking", "on edge", "stress", "stressed", "tense",
    ],
    "sadness": [
        "sad", "crying", "tears", "depressed", "depression", "down",
        "unhappy", "miserable", "heartbroken", "grief", "mourning", "lost",
    ],
    "anger": [
        "angry", "furious", "rage", "mad", "irritated", "frustrated",
        "resentful", "annoyed", "pissed",
    ],
    "fear": [
        "scared", "afraid", "terrified", "frightened", "fear", "dread",
        "phobia",
    ],
    "loneliness": [
        "lonely", "alone", "isolated", "abandoned", "invisible",
        "no one", "nobody", "disconnected",
    ],
    "guilt": [
        "guilty", "guilt", "ashamed", "shame", "blame myself",
        "my fault", "regret",
    ],
    "hopelessness": [
        "hopeless", "worthless", "pointless", "no purpose", "give up",
        "can't go on", "trapped",
    ],
}

# ─── Simple entity patterns ──────────────────────────────────────────────────
_NAME_PATTERN = re.compile(
    r"(?:my name is|i'm|i am|call me|they call me)\s+([A-Z][a-z]+)",
    re.IGNORECASE,
)
_PERSON_PATTERN = re.compile(
    r"(?:my\s+(?:friend|brother|sister|mom|mother|dad|father|partner|wife|husband|boss|therapist|doctor))\s+([A-Z][a-z]+)",
    re.IGNORECASE,
)
_PREFERENCE_PATTERN = re.compile(
    r"(?:i (?:like|love|enjoy|prefer|hate|dislike))\s+(.+?)(?:\.|,|$)",
    re.IGNORECASE,
)


@dataclass
class Session:
    """Holds the full state for one chat session."""
    session_id: str
    messages: List[dict] = field(default_factory=list)        # full history
    llm_history: List[dict] = field(default_factory=list)     # what the LLM sees
    entities: Dict[str, str] = field(default_factory=dict)    # extracted named entities
    preferences: List[str] = field(default_factory=list)      # user preferences
    emotion_state: str = "neutral"
    emotion_confidence: float = 0.0
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)


# ─── In-memory store ─────────────────────────────────────────────────────────
_sessions: Dict[str, Session] = {}


def get_or_create(session_id: str, system_prompt: str) -> Session:
    """Return an existing session or create a fresh one."""
    if session_id not in _sessions:
        s = Session(session_id=session_id)
        s.llm_history = [{"role": "system", "content": system_prompt}]
        _sessions[session_id] = s
    return _sessions[session_id]


def get(session_id: str) -> Session | None:
    return _sessions.get(session_id)


def reset(session_id: str, system_prompt: str) -> Session:
    """Wipe a session and start fresh."""
    s = Session(session_id=session_id)
    s.llm_history = [{"role": "system", "content": system_prompt}]
    _sessions[session_id] = s
    return s


# ─── Entity extraction ───────────────────────────────────────────────────────

def extract_entities(text: str, session: Session) -> Dict[str, str]:
    """
    Pull lightweight named entities / preferences out of the user message
    and persist them in the session.  Returns *only* the newly-found entities.
    """
    new = {}

    m = _NAME_PATTERN.search(text)
    if m:
        name = m.group(1)
        session.entities["user_name"] = name
        new["user_name"] = name

    for m in _PERSON_PATTERN.finditer(text):
        key = m.group(0).split()[1].lower()  # e.g. "friend"
        val = m.group(1)
        session.entities[key] = val
        new[key] = val

    for m in _PREFERENCE_PATTERN.finditer(text):
        pref = m.group(1).strip()
        if pref and pref not in session.preferences:
            session.preferences.append(pref)
            new[f"preference_{len(session.preferences)}"] = pref

    return new


# ─── Emotion inference ────────────────────────────────────────────────────────

def infer_emotion(text: str, session: Session) -> dict:
    """
    Heuristic keyword-based emotion classification.
    Returns { label, confidence, keywords_matched }.
    """
    lower = text.lower()
    scores: Dict[str, int] = {}

    for emotion, keywords in _EMOTION_LEXICON.items():
        hits = [kw for kw in keywords if kw in lower]
        if hits:
            scores[emotion] = len(hits)

    if not scores:
        session.emotion_state = "neutral"
        session.emotion_confidence = 0.0
        return {"label": "neutral", "confidence": 0.0, "keywords_matched": []}

    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    total_hits = sum(scores.values())
    confidence = round(min(scores[best] / max(total_hits, 1) * 100, 100), 1)

    session.emotion_state = best
    session.emotion_confidence = confidence

    matched = []
    for kw in _EMOTION_LEXICON[best]:
        if kw in lower:
            matched.append(kw)

    return {"label": best, "confidence": confidence, "keywords_matched": matched}


# ─── Context window ──────────────────────────────────────────────────────────

def get_context_window(session: Session) -> List[dict]:
    """
    Return the most recent turns trimmed to MAX_CONTEXT_TURNS,
    always including the system prompt at index 0.
    """
    system = session.llm_history[0:1]  # always keep system prompt
    recent = session.llm_history[1:]
    # Each turn is 2 messages (user + assistant), so keep 2 * MAX_CONTEXT_TURNS
    trimmed = recent[-(MAX_CONTEXT_TURNS * 2):]
    return system + trimmed


def add_user_turn(session: Session, raw_message: str, augmented_message: str):
    """Save the user's message to both visible and LLM histories."""
    session.messages.append({"role": "user", "content": raw_message})
    session.llm_history.append({"role": "user", "content": augmented_message})
    session.last_active = time.time()


def add_assistant_turn(session: Session, raw_message: str, user_raw: str):
    """
    Save the assistant reply. Also fix up the LLM history so we don't
    persist the RAG-augmented version of the user turn — exactly like the
    original app.py did.
    """
    session.messages.append({"role": "assistant", "content": raw_message})
    # Replace the augmented user turn with the raw one to save context tokens
    if len(session.llm_history) >= 2:
        session.llm_history[-1] = {"role": "user", "content": user_raw}
    session.llm_history.append({"role": "assistant", "content": raw_message})
    session.last_active = time.time()
