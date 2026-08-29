#!/bin/bash

cd /home/web-h-063/Documents/explainer-bot || exit 1

echo "Starting chat server..."
python chat_server.py &

CHAT_PID=$!

echo "Chat server started with PID: $CHAT_PID"
echo "Starting cloudflared tunnel..."

cloudflared tunnel \
  --config /home/web-h-063/.cloudflared/webclaude/config.yml \
  run

# If cloudflared exits, stop the chat server too
kill "$CHAT_PID" 2>/dev/null
