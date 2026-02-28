#!/bin/bash

# Start the server in development mode

set -e

echo "🚀 Starting MCP Desktop Commander HTTP Server (Development Mode)"
echo "================================================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Set default environment variables
export WORKSPACE_PATH=${WORKSPACE_PATH:-/home/ferreirase/Documents}
export PORT=${PORT:-8085}
export LOG_LEVEL=${LOG_LEVEL:-debug}
export REQUEST_TIMEOUT=${REQUEST_TIMEOUT:-30000}

echo "Configuration:"
echo "  WORKSPACE_PATH: $WORKSPACE_PATH"
echo "  PORT: $PORT"
echo "  LOG_LEVEL: $LOG_LEVEL"
echo "  REQUEST_TIMEOUT: $REQUEST_TIMEOUT"
echo ""

echo "Starting server..."
npm run dev
