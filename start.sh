#!/usr/bin/env bash
set -e
cd "$(dirname "$0")" || exit 1
# Load .env (e.g. OPENCODE_SERVER_PASSWORD) so the managed OpenCode server is not started unsecured.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
SCRIPT_DIR="$(pwd)"
# Kill any previous start scripts, Electron apps, agent-relay desktop/service processes
for pid in $(pgrep -f "$SCRIPT_DIR/start.sh" 2>/dev/null); do [ "$pid" != "$$" ] && kill -9 "$pid" 2>/dev/null || true; done
for pid in $(pgrep -f "$SCRIPT_DIR/start.command" 2>/dev/null); do [ "$pid" != "$$" ] && kill -9 "$pid" 2>/dev/null || true; done
# Kill any Electron instance (not just this checkout)
pkill -9 -x "Electron" 2>/dev/null || true
pkill -9 -f "Agent Relay" 2>/dev/null || true
pkill -9 -f "agent-relay" 2>/dev/null || true
# Kill build/compile terminals and node/npm processes from this checkout
for pid in $(pgrep -f "node.*$SCRIPT_DIR" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill -9 "$pid" 2>/dev/null || true; done
for pid in $(pgrep -f "npm.*$SCRIPT_DIR" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill -9 "$pid" 2>/dev/null || true; done
for pid in $(pgrep -f "tsx.*$SCRIPT_DIR" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill -9 "$pid" 2>/dev/null || true; done
for pid in $(pgrep -f "tsc.*$SCRIPT_DIR" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill -9 "$pid" 2>/dev/null || true; done
# Kill parent terminal shells that launched previous builds (if referencing this dir),
# but never kill the current script ($$) or its parent terminal ($PPID) that launched us.
for pid in $(pgrep -f "bash.*$SCRIPT_DIR\|zsh.*$SCRIPT_DIR\|Terminal.*Agent Relay" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill -9 "$pid" 2>/dev/null || true; done
# Kill the desktop bundle and service bundle explicitly
pkill -9 -f "desktop/main/index.js" 2>/dev/null || true
pkill -9 -f "service/service.bundle.cjs" 2>/dev/null || true
sleep 0.5

if ! caffeinate -imsd npm run desktop:relay; then
  echo
  echo "Agent Relay failed to start."
  echo "Press Enter to close this window."
  read -r
  exit 1
fi
