#!/bin/sh
# Start Supervertaler Okapi Java sidecar (DOCX/PPTX/XLSX extract/merge) on port 8091.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
JAR="${OKAPI_JAVA_JAR:-$ROOT/binaries/okapi-java-sidecar/okapi-sidecar.jar}"
PORT="${OKAPI_JAVA_PORT:-8091}"

if [ ! -f "$JAR" ]; then
  echo "[okapi-java] ERROR: JAR not found: $JAR" >&2
  echo "[okapi-java] Download okapi-sidecar-v0.1.7.jar from Supervertaler releases." >&2
  exit 1
fi

JAVA_CMD="${JAVA_HOME:+$JAVA_HOME/bin/}java"
if ! command -v "$JAVA_CMD" >/dev/null 2>&1; then
  JAVA_CMD=java
fi

exec "$JAVA_CMD" -jar "$JAR" "--port=$PORT"
