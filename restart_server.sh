#!/bin/bash
fuser -k 8225/tcp 2>/dev/null
sleep 1
cd /home/web-h-063/Documents/explainer-bot
python chat_server.py &
sleep 2
echo "Server restarted"
