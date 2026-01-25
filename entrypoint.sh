#!/bin/bash
set -e

# Ensure data directories exist
mkdir -p /data/{db,state,config}
mkdir -p /data/config/gh
mkdir -p /data/config/claude

# Set up git config
git config --global user.name "Orchestr8"
git config --global user.email "orchestr8@local"

# Copy default Claude settings if not already present in volume
if [ ! -f /data/config/claude/settings.json ]; then
    echo "Initializing Claude settings..."
    cp -r ~/.claude/* /data/config/claude/ 2>/dev/null || true
fi

# Link config directories so tools find their auth
mkdir -p ~/.config
ln -sf /data/config/gh ~/.config/gh 2>/dev/null || true
rm -rf ~/.claude 2>/dev/null || true
ln -sf /data/config/claude ~/.claude

# Also persist .claude.json (separate from .claude directory)
# This file contains OAuth account state that must persist
if [ -f ~/.claude.json ] && [ ! -f /data/config/claude.json ]; then
    echo "Copying existing .claude.json to volume..."
    cp ~/.claude.json /data/config/claude.json
fi
rm -f ~/.claude.json ~/.claude.json.backup 2>/dev/null || true
ln -sf /data/config/claude.json ~/.claude.json
ln -sf /data/config/claude.json.backup ~/.claude.json.backup 2>/dev/null || true

# Verify claude is in PATH
echo "Claude location: $(which claude || echo 'not found')"

# Start git daemon in background (will serve bare.git once cloned)
if [ -d /data/bare.git ]; then
    git daemon --reuseaddr --base-path=/data --export-all --enable=receive-pack --port=9418 &
fi

# Start the server (logs to stdout for docker logs)
exec node ./packages/server/dist/index.js
