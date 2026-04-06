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

# The venv lives on a native Linux FS because the project drive (NTFS) can't create symlinks.
# If you move this project, recreate the venv:
#   python3 -m venv /tmp/mindbridge_venv
#   /tmp/mindbridge_venv/bin/pip install -r requirements.txt

VENV="/tmp/mindbridge_venv"
if [ ! -f "$VENV/bin/python" ]; then
  echo "[!] Virtual environment not found at $VENV"
  echo "    Create it:  python3 -m venv $VENV && $VENV/bin/pip install -r requirements.txt"
  exit 1
fi

"$VENV/bin/uvicorn" backend.main:app --host 0.0.0.0 --port 8000 --reload
