#!/bin/sh
set -eu

OKAPI_HOST="${OKAPI_HOST:-127.0.0.1}"
OKAPI_PORT="${OKAPI_PORT:-8090}"
export OKAPI_HOST OKAPI_PORT
export OKAPI_UPSTREAM_URL="${OKAPI_UPSTREAM_URL:-http://${OKAPI_HOST}:${OKAPI_PORT}}"
export SMARTCAT_SPAWN_OKAPI=0
export PATH="/usr/local/bin:$PATH"

echo "[render-start] python3=$(command -v python3 || echo missing)"
echo "[render-start] pip3=$(command -v pip3 || echo missing)"

if ! python3 -c "import uvicorn" 2>/dev/null; then
  echo "[render-start] uvicorn missing, running pip install…"
  PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir -r /app/scripts/okapi-sidecar/requirements.txt
fi

if [ -x /usr/local/bin/uvicorn ]; then
  UVICORN_CMD="/usr/local/bin/uvicorn"
else
  UVICORN_CMD="python3 -m uvicorn"
fi
$UVICORN_CMD --version

echo "[render-start] Starting Okapi at http://${OKAPI_HOST}:${OKAPI_PORT}"
cd /app/scripts/okapi-sidecar
if [ -x /usr/local/bin/uvicorn ]; then
  /usr/local/bin/uvicorn main:app --host "$OKAPI_HOST" --port "$OKAPI_PORT" &
else
  python3 -m uvicorn main:app --host "$OKAPI_HOST" --port "$OKAPI_PORT" &
fi
okapi_pid=$!

ready=0
i=0
while [ "$i" -lt 120 ]; do
  if python3 -c "
import json, os, urllib.request, sys
host = os.environ.get('OKAPI_HOST', '127.0.0.1')
port = os.environ.get('OKAPI_PORT', '8090')
try:
    with urllib.request.urlopen(f'http://{host}:{port}/health', timeout=2) as r:
        data = json.loads(r.read().decode())
        sys.exit(0 if data.get('ok') else 1)
except Exception:
    sys.exit(1)
"; then
    ready=1
    echo "[render-start] Okapi ready (pid=${okapi_pid})"
    break
  fi
  if ! kill -0 "$okapi_pid" 2>/dev/null; then
    echo "[render-start] Okapi exited before becoming healthy"
    wait "$okapi_pid" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 0.5
done

if [ "$ready" -eq 0 ]; then
  echo "[render-start] WARN: Okapi health timeout after 60s"
fi

cd /app
exec node server/index.mjs
