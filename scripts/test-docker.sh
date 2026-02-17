#!/bin/bash

# Test Docker container

set -e

echo "🧪 Testing Docker container"
echo "==========================="
echo ""

# Check if container is running
if ! docker compose ps | grep -q "mcp-desktop-commander.*running"; then
    echo "❌ Container is not running"
    echo "Start it with: docker compose up -d"
    exit 1
fi

echo "Container is running ✅"
echo ""

# Wait for server to be ready
echo "Waiting for server to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8081/health > /dev/null 2>&1; then
        echo "Server is ready ✅"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Server did not become ready in time"
        docker compose logs --tail=50
        exit 1
    fi
    sleep 1
done

echo ""

# Run tests
../test-server.sh
