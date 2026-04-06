"""
Central configuration for the Mental Health Support AI backend.
All tunable constants live here.
"""

import os

# ─── LLM (LM Studio) ─────────────────────────────────────────────────────────
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:1234/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "lm-studio")
LLM_MODEL = os.getenv("LLM_MODEL", "local-model")
LLM_TEMPERATURE = 0.7
LLM_MAX_TOKENS = 25753
LLM_REASONING_EFFORT = "low"

# ─── Embeddings ───────────────────────────────────────────────────────────────
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DEVICE = "cpu"

# ─── ChromaDB ─────────────────────────────────────────────────────────────────
CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_db")
CHROMA_COLLECTION = "mental_health_rag"

# ─── RAG ──────────────────────────────────────────────────────────────────────
RAG_TOP_K = 2  # number of documents to retrieve

# ─── Knowledge base source ────────────────────────────────────────────────────
KB_JSON_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "legacy", "mental_health_kb.json")

# ─── Session / Memory ────────────────────────────────────────────────────────
MAX_CONTEXT_TURNS = 10  # how many turns to keep in the LLM context window

# ─── System Prompt ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = (
    "You are a specialized, conversational emotional support AI. "
    "You must read between the lines to detect underlying distress. "
    "NEVER use generic platitudes like 'I'm sorry you feel that way'.\n\n"
    "RULES:\n"
    "1. Be CONCISE (maximum 3-4 sentences).\n"
    "2. Validate the specific emotion, do not just dispense advice.\n"
    "3. If RETRIEVED CONTEXT is provided, gently weave ONE mechanism into the conversation.\n"
    "4. ALWAYS end your response with a targeted, open-ended question that encourages "
    "the user to keep exploring their feelings."
)

SAFETY_ESCALATION_ADDENDUM = (
    "\n\n⚠️ SAFETY ALERT — The user's message has been flagged as high-risk. "
    "Your IMMEDIATE priority is:\n"
    "1. Acknowledge their pain directly and without judgment.\n"
    "2. Gently provide the 988 Suicide & Crisis Lifeline (call/text 988) "
    "and the Crisis Text Line (text HOME to 741741).\n"
    "3. Do NOT lecture. Be warm and concise."
)

# ─── Safety Keywords ─────────────────────────────────────────────────────────
SAFETY_KEYWORDS_HIGH = [
    "kill myself", "want to die", "end my life", "suicide", "suicidal",
    "don't want to live", "no reason to live", "better off dead",
    "planning to end it", "goodbye letter", "final note",
    "self-harm", "cutting myself", "hurt myself",
]

SAFETY_KEYWORDS_MEDIUM = [
    "hopeless", "worthless", "can't go on", "can't take it anymore",
    "nobody cares", "burden to everyone", "disappear", "give up",
    "no point", "tired of living", "crying every day",
    "panic attack", "can't breathe", "overdose",
]
