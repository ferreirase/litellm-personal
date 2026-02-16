#!/bin/bash
# Simple test to capture all backlog MCP output

echo "=== Full Output Capture Test ==="
echo ""

cd /data

# Test creating a task with full response capture
echo "Sending tools/call request..."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task_create","arguments":{"title":"Diagnostic Test Task","description":"Testing MCP communication"}}}' | backlog mcp start > /tmp/backlog-response.txt

echo ""
echo "Full response:"
cat /tmp/backlog-response.txt
echo ""

echo "Checking if task was created..."
ls -la /data/backlog/tasks/ 2>/dev/null | head -5
echo ""

echo "=== Test Complete ==="
