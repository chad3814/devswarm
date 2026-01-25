#!/bin/bash
set -e

# Ensure data directories exist
mkdir -p /data/{db,state,config}

# Set up git config
git config --global user.name "Orchestr8"
git config --global user.email "orchestr8@local"

# Link config directories so tools find their auth
mkdir -p ~/.config
ln -sf /data/config/gh ~/.config/gh 2>/dev/null || true
ln -sf /data/config/claude ~/.claude 2>/dev/null || true

# Start tmux server
tmux new-session -d -s orchestr8 -n main

# Start git daemon in background (will serve bare.git once cloned)
if [ -d /data/bare.git ]; then
    git daemon --reuseaddr --base-path=/data --export-all --enable=receive-pack --port=9418 &
fi

# Start the server (logs to stdout for docker logs)
exec node ./packages/server/dist/index.js
