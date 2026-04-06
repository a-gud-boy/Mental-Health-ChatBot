"""
FastAPI application — serves the chat API (SSE streaming) and the static frontend.

Run with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import config, llm, memory, rag, safety

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Mental Health Support AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Readiness state ─────────────────────────────────────────────────────────
_ready = False
_loading_status = "Initializing…"


def _load_models():
    """Load heavy models in a background thread so uvicorn starts responding immediately."""
    global _ready, _loading_status
    try:
        _loading_status = "Loading knowledge base…"
        rag.build_db()
        _loading_status = "Loading embedding model…"
        rag.init()
        _loading_status = "Ready"
        _ready = True
        print("[Server] All models loaded — backend ready.")
    except Exception as e:
        _loading_status = f"Error: {e}"
        print(f"[Server] Model loading failed: {e}")


@app.on_event("startup")
def on_startup():
    threading.Thread(target=_load_models, daemon=True).start()
    print("[Server] Starting model loading in background…")


# ─── Models ───────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str


class ResetRequest(BaseModel):
    session_id: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Returns model loading status. Frontend polls this on page load."""
    return {"ready": _ready, "status": _loading_status}


@app.post("/api/chat")
def chat(req: ChatRequest):
    """
    Main chat endpoint — returns a Server-Sent Events stream.

    Event types sent to the client:
        thinking   : LLM reasoning tokens
        content    : visible reply tokens
        metadata   : JSON blob with emotion, entities, rag_sources, safety info
    """
    sid = req.session_id or str(uuid.uuid4())
    user_msg = req.message.strip()

    if not _ready:
        return JSONResponse({"error": "Models are still loading. Please wait."}, status_code=503)

    if not user_msg:
        return JSONResponse({"error": "Message cannot be empty."}, status_code=400)

    # 1. Get / create session
    session = memory.get_or_create(sid, config.SYSTEM_PROMPT)

    # 2. Safety check
    safety_result = safety.check(user_msg)

    # 3. Entity extraction & emotion inference
    new_entities = memory.extract_entities(user_msg, session)
    emotion = memory.infer_emotion(user_msg, session)

    # 4. RAG retrieval
    rag_results = rag.query(user_msg)
    rag_text = "\n\n".join(r["document"] for r in rag_results) if rag_results else ""
    rag_sources = [{"source": r["source"], "distance": r["distance"],
                    "snippet": r["document"][:200] + "…"} for r in rag_results]

    # 5. Augmented prompt
    augmented = f"RETRIEVED CONTEXT:\n{rag_text}\n\nUSER MESSAGE:\n{user_msg}"
    memory.add_user_turn(session, user_msg, augmented)

    # Inject safety addendum if high-risk
    messages = memory.get_context_window(session)
    if safety_result["risk_level"] == "high":
        # Temporarily augment the system prompt for this call
        messages = [
            {"role": "system", "content": config.SYSTEM_PROMPT + config.SAFETY_ESCALATION_ADDENDUM}
        ] + messages[1:]

    # 6. Stream
    def event_stream():
        # Send session_id first so the client can persist it
        yield _sse("session_id", json.dumps({"session_id": sid}))

        # Send safety info immediately
        yield _sse("safety", json.dumps(safety_result))

        full_reply = ""
        for chunk in llm.stream_chat(messages):
            if chunk["type"] == "thinking":
                yield _sse("thinking", chunk["content"])
            elif chunk["type"] == "content":
                full_reply += chunk["content"]
                yield _sse("content", chunk["content"])
            elif chunk["type"] == "done":
                full_reply = chunk.get("content", full_reply)

        # Persist assistant turn
        memory.add_assistant_turn(session, full_reply, user_msg)

        # Build metadata payload
        meta = {
            "emotion": emotion,
            "entities": dict(session.entities),
            "preferences": list(session.preferences),
            "new_entities": new_entities,
            "rag_sources": rag_sources,
            "safety": safety_result,
            "turn_count": len(session.messages) // 2,
        }
        yield _sse("metadata", json.dumps(meta))

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    """Return full session state (for the debug panel on page reload)."""
    session = memory.get(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    return {
        "session_id": session.session_id,
        "messages": session.messages,
        "entities": session.entities,
        "preferences": session.preferences,
        "emotion_state": session.emotion_state,
        "emotion_confidence": session.emotion_confidence,
        "turn_count": len(session.messages) // 2,
    }


@app.post("/api/reset")
def reset_session(req: ResetRequest):
    """Clear a session and start fresh."""
    memory.reset(req.session_id, config.SYSTEM_PROMPT)
    return {"status": "ok", "session_id": req.session_id}


# ─── Static files (frontend) — MUST be last ──────────────────────────────────
_frontend = Path(__file__).resolve().parent.parent / "frontend"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _sse(event: str, data: str) -> str:
    """Format a single Server-Sent Event frame."""
    return f"event: {event}\ndata: {data}\n\n"
