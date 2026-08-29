#!/bin/bash

echo "Stopping WebClaude..."

# Stop chat server
pkill -f "chat_server.py"

# Stop cloudflared tunnel using the webclaude config
pkill -f "cloudflared.*webclaude"

echo "WebClaude stopped."
