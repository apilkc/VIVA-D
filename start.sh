#!/bin/sh
# Wait for the volume mount at /app/data (Railway mounts volumes after container start)
MAX_WAIT=30
ELAPSED=0
while [ ! -d "/app/data" ] && [ $ELAPSED -lt $MAX_WAIT ]; do
  echo "Waiting for volume mount... ($ELAPSED/$MAX_WAIT)"
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

# Ensure the data directory exists
mkdir -p /app/data

echo "Starting application..."
exec node server.js
