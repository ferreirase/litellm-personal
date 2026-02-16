#!/bin/bash
# Test script to diagnose backlog MCP issue

echo "=== Backlog MCP Diagnostic Test ==="
echo ""

cd /data

# Test 1: List tools
echo "Test 1: Listing tools..."
TOOLS_RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | backlog mcp start)
echo "$TOOLS_RESPONSE" | grep -o '"tools"' | head -1
echo ""

# Test 2: Create a task
echo "Test 2: Creating task..."
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"task_create","arguments":{"title":"Test Task","description":"Created via diagnostic script"}}}' | backlog mcp start
echo ""

# Test 3: List tasks
echo "Test 3: Listing tasks..."
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"task_list","arguments":{}}}' | backlog mcp start
echo ""

echo "=== Tests Complete ==="
