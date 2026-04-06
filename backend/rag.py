"""
RAG pipeline — semantic retrieval from ChromaDB using SentenceTransformer embeddings.
"""

from __future__ import annotations

import json
from typing import List

import chromadb
from sentence_transformers import SentenceTransformer

from backend.config import (
    CHROMA_COLLECTION,
    CHROMA_DB_PATH,
    EMBEDDING_DEVICE,
    EMBEDDING_MODEL,
    KB_JSON_PATH,
    RAG_TOP_K,
)

# ─── Singletons (loaded once) ────────────────────────────────────────────────
_embedder: SentenceTransformer | None = None
_collection = None


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        print("[RAG] Loading embedding model …")
        _embedder = SentenceTransformer(EMBEDDING_MODEL, device=EMBEDDING_DEVICE)
        print("[RAG] Embedding model ready.")
    return _embedder


def _get_collection():
    global _collection
    if _collection is None:
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        _collection = client.get_or_create_collection(name=CHROMA_COLLECTION)
    return _collection


def init():
    """Eagerly load embedder + collection so the first query is fast."""
    _get_embedder()
    _get_collection()


# ─── Public API ───────────────────────────────────────────────────────────────

def query(text: str, n: int = RAG_TOP_K) -> List[dict]:
    """
    Retrieve the *n* most relevant documents for *text*.

    Returns a list of dicts:
        [{ "document": str, "source": str, "distance": float }, …]
    """
    embedder = _get_embedder()
    collection = _get_collection()

    vec = embedder.encode(text).tolist()
    results = collection.query(query_embeddings=[vec], n_results=n)

    docs: List[dict] = []
    if results["documents"]:
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            dist = results["distances"][0][i] if results["distances"] else 0.0
            docs.append({
                "document": doc,
                "source": meta.get("source", "unknown"),
                "distance": round(dist, 4),
            })
    return docs


def build_db() -> int:
    """
    Idempotent ingestion — only populates the collection if it is empty.
    Returns the final document count.
    """
    collection = _get_collection()

    if collection.count() > 0:
        print(f"[RAG] Collection already has {collection.count()} documents — skipping ingest.")
        return collection.count()

    print(f"[RAG] Building vector DB from {KB_JSON_PATH} …")
    with open(KB_JSON_PATH, "r") as f:
        data = json.load(f)

    embedder = _get_embedder()

    docs, metadatas, ids = [], [], []
    for idx, item in enumerate(data):
        advice = item["helpful_advice"][0]["advice_body"]
        full_text = f"User Issue: {item['user_issue_body']}\nAdvice: {advice}"
        docs.append(full_text)
        metadatas.append({"source": item["subreddit"]})
        ids.append(f"doc_{idx}")

    embeddings = embedder.encode(docs).tolist()
    collection.add(
        embeddings=embeddings,
        documents=docs,
        metadatas=metadatas,
        ids=ids,
    )
    count = collection.count()
    print(f"[RAG] Ingested {count} documents.")
    return count
