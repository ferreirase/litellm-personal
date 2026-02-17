#!/bin/bash

# Rebuild and restart Docker container

set -e

echo "🔨 Rebuilding and restarting Docker container"
echo "=============================================="
echo ""

echo "Stopping existing container..."
docker compose down

echo ""
echo "Rebuilding image..."
docker compose build --no-cache

echo ""
echo "Starting container..."
docker compose up -d

echo ""
echo "Waiting for container to be healthy..."
sleep 5

echo ""
echo "Container status:"
docker compose ps

echo ""
echo "Container logs (last 20 lines):"
docker compose logs --tail=20

echo ""
echo "✅ Container rebuilt and started successfully!"
echo ""
echo "Health check: http://localhost:8081/health"
echo "MCP endpoint: http://localhost:8081/mcp"
