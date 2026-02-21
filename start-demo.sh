#!/usr/bin/env bash
# CREHub full-stack demo launcher
# Starts: gateway (8080) + backend (4000) + frontend (3000)
# Usage: bash start-demo.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         CREHub Demo Stack                ║"
echo "║  gateway :8080  backend :4000  ui :3000  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Cleanup on exit ────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Stopping all services..."
  kill "$GATEWAY_PID" "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── Gateway ───────────────────────────────────────────────────────────────────
echo "[1/3] Starting gateway on :8080 ..."
cd "$ROOT/gateway"
PORT=8080 bun run dev &> "$ROOT/.gateway.log" &
GATEWAY_PID=$!

# ── Backend ───────────────────────────────────────────────────────────────────
echo "[2/3] Starting backend on :4000 ..."
cd "$ROOT/backend"
PORT=4000 bun run dev &> "$ROOT/.backend.log" &
BACKEND_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "[3/3] Starting frontend on :3000 ..."
cd "$ROOT/frontend"
bun run dev &> "$ROOT/.frontend.log" &
FRONTEND_PID=$!

echo ""
echo "  All services started:"
echo "  • Gateway   → http://localhost:8080/health"
echo "  • Backend   → http://localhost:4000/api/workflows"
echo "  • Frontend  → http://localhost:3000"
echo ""
echo "  Logs: .gateway.log  .backend.log  .frontend.log"
echo "  Press Ctrl+C to stop all."
echo ""

# ── Wait ──────────────────────────────────────────────────────────────────────
wait "$GATEWAY_PID" "$BACKEND_PID" "$FRONTEND_PID"
