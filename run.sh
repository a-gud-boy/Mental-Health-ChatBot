#!/usr/bin/env bash
# ─── MindBridge Launcher ─────────────────────────────────────────────────────
# Usage:  ./run.sh
#
# Starts the FastAPI backend + serves the frontend on http://localhost:8000

set -e

cd "$(dirname "$0")"

echo "══════════════════════════════════════════════════════════════"
echo "  🧠  MindBridge — Emotional Support AI"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Starting server on  http://localhost:8000"
echo "  Make sure LM Studio is running on localhost:1234"
echo ""
echo "══════════════════════════════════════════════════════════════"

# The venv is set to use the rag_env from conda.
# If dependencies are missing, install them:
#   /home/bruno/miniconda3/envs/rag_env/bin/pip install -r requirements.txt

VENV="/home/bruno/miniconda3/envs/rag_env"
if [ ! -f "$VENV/bin/python" ]; then
  echo "[!] Conda environment not found at $VENV"
  echo "    Please create it using: conda create -n rag_env python=3.10 (or whatever version)"
  exit 1
fi

"$VENV/bin/uvicorn" backend.main:app --host 0.0.0.0 --port 8000 --reload
