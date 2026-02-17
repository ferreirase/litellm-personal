#!/bin/bash

# Test script for MCP Desktop Commander HTTP Server

set -e

BASE_URL="http://localhost:8081"
MCP_ENDPOINT="$BASE_URL/mcp"

echo "🧪 Testing MCP Desktop Commander HTTP Server"
echo "=============================================="
echo ""

# Test 1: Health check
echo "1️⃣  Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s "$BASE_URL/health")
echo "Response: $HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi
echo ""

# Test 2: Initialize MCP
echo "2️⃣  Testing MCP initialize..."
INIT_RESPONSE=$(curl -s -X POST "$MCP_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }')
echo "Response: $INIT_RESPONSE"
if echo "$INIT_RESPONSE" | grep -q '"jsonrpc":"2.0"'; then
    echo "✅ Initialize passed"
else
    echo "❌ Initialize failed"
    exit 1
fi
echo ""

# Test 3: List tools
echo "3️⃣  Testing tools/list..."
TOOLS_RESPONSE=$(curl -s -X POST "$MCP_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }')
echo "Response (truncated): ${TOOLS_RESPONSE:0:200}..."
if echo "$TOOLS_RESPONSE" | grep -q '"jsonrpc":"2.0"'; then
    echo "✅ List tools passed"
else
    echo "❌ List tools failed"
    exit 1
fi
echo ""

# Test 4: Ping (custom method)
echo "4️⃣  Testing ping..."
PING_RESPONSE=$(curl -s -X POST "$MCP_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "ping",
    "params": {},
    "id": 3
  }')
echo "Response: $PING_RESPONSE"
if echo "$PING_RESPONSE" | grep -q '"pong":true'; then
    echo "✅ Ping passed"
else
    echo "❌ Ping failed"
    exit 1
fi
echo ""

echo "=============================================="
echo "✅ All tests passed!"
echo ""
