#!/bin/bash
set -e

# Initialize backlog.md if not already initialized
if [ ! -d "/data/backlog" ]; then
    echo "Initializing Backlog.md project..."
    cd /data
    git init -q
    backlog init "MCP Gateway" --defaults 2>&1 | grep -v "^hint:"
    echo "Backlog.md initialized successfully"
else
    echo "Backlog.md already initialized, skipping..."
fi

# Copy project's backlog.md if it doesn't exist (optional reference)
if [ ! -f "/data/backlog.md" ] && [ -f "/app/backlog.md" ]; then
    cp /app/backlog.md /data/backlog.md 2>/dev/null || true
fi
