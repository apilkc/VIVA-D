#!/bin/sh
# Wait for Railway volume mount at /app/data to be ready.
# Railway creates the directory first, then bind-mounts the volume later.
# We detect readiness by checking if the mount is actually there.

MAX_WAIT=30
ELAPSED=0
echo "Checking volume mount at /app/data..."

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Check if /app/data exists AND is writable AND has been bind-mounted
  # A simple write test: try to create and remove a sentinel file
  if [ -d "/app/data" ] && touch /app/data/.mount-test 2>/dev/null; then
    rm -f /app/data/.mount-test
    # Wait a bit more to let the bind mount settle
    sleep 3
    # Do another write test after waiting
    if touch /app/data/.mount-test 2>/dev/null; then
      rm -f /app/data/.mount-test
      echo "Volume ready at /app/data (${ELAPSED}s)"
      break
    fi
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "Volume not ready after ${MAX_WAIT}s, using /tmp/data as fallback"
  mkdir -p /tmp/data
  export DB_PATH=/tmp/data/media.db
fi

echo "Starting application..."
exec node server.js
