"""
Standalone ingestion script.

Usage:
    python -m backend.ingest

Reads legacy/mental_health_kb.json, embeds documents, and upserts them into
ChromaDB.  Idempotent: does nothing if the collection is already populated.
"""

from backend.rag import build_db


def main():
    count = build_db()
    print(f"[Ingest] Done — collection has {count} documents.")


if __name__ == "__main__":
    main()
