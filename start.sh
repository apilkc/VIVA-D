#!/bin/sh
# Wait for the Railway volume mount at /app/data
# The directory won't exist until the volume is mounted (removed mkdir from Dockerfile).
MAX_WAIT=60
ELAPSED=0
while [ ! -d "/app/data" ]; do
  echo "Waiting for volume mount... ($ELAPSED/$MAX_WAIT)"
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "Volume mount timed out, falling back to /tmp/data"
    mkdir -p /tmp/data
    export DB_PATH=/tmp/data/media.db
    break
  fi
done

if [ -d "/app/data" ]; then
  echo "Volume mounted at /app/data"
fi

echo "Starting application..."
exec node server.js
