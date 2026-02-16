# Backlog MCP Connection Fix - Summary

## Problem Identified

The backlog MCP server was experiencing connection cycling issues:

1. **Multiple simultaneous sessions** - LiteLLM created 2-3 sessions in parallel (within milliseconds)
2. **Each session spawned a new process** - Every session created a NEW `MCPServer` instance, which spawned a NEW `backlog mcp start` stdio process
3. **Resource contention** - Multiple backlog processes competed for the same backlog directory
4. **Rapid connection cycling** - Sessions opened and closed immediately, creating overhead

### Evidence from logs.txt

Example from 15:14:21-15:14:23:
```
2026-02-16T15:14:21.794Z ✅ [backlog] Session initialized: 16ed7a08
2026-02-16T15:14:21.795Z 🔧 [backlog] Creating MCPServer with 21 tools  ← NEW SERVER
2026-02-16T15:14:21.797Z ✅ [backlog] Session initialized: 62b2030d      ← 3ms later
2026-02-16T15:14:22.595Z ✅ [backlog] Session initialized: 9a0ac6a4      ← 800ms later
2026-02-16T15:14:22.596Z 🔧 [backlog] Creating MCPServer with 21 tools  ← NEW SERVER AGAIN
2026-02-16T15:14:22.597Z ✅ [backlog] Session initialized: 242a1213      ← 2ms later
```

**Result:** Multiple `backlog mcp start` processes running simultaneously, causing instability.

## Solution Implemented

Refactored architecture to **share one stdio process per segment** across all sessions:

### Key Changes (src/index.ts)

1. **Added segment servers storage:**
   ```typescript
   const segmentServers: Record<string, MCPServer> = {};
   ```

2. **Modified createSegmentRoute():**
   - Changed from accepting `tools` to accepting `server` instance
   - Creates new transport per session (lightweight)
   - Reuses shared server across all sessions
   ```typescript
   function createSegmentRoute(segmentName: string, server: MCPServer)
   ```

3. **Updated initializeSegments():**
   - Creates ONE MCPServer per segment at startup
   - Stores in segmentServers map
   - Passes shared server to createSegmentRoute
   ```typescript
   segmentServers[name] = new MCPServer({
     id: `${name}-server`,
     name: `MCP ${name} Server`,
     version: "1.4.0",
     tools: toolCaches[name],
   });
   ```

## Results

### Before Fix
```
🔧 [backlog] Creating MCPServer with 21 tools  ← EVERY SESSION
✅ [backlog] Session initialized: xyz
🔧 [backlog] Creating MCPServer with 21 tools  ← EVERY SESSION
✅ [backlog] Session initialized: abc
```
**Result:** Multiple stdio processes spawned

### After Fix
```
📦 [backlog] Creating shared MCPServer with 21 tools  ← ONCE AT STARTUP
🚀 Route created: /backlog/mcp

🔧 [backlog] Creating new transport for session (reusing shared server)
✅ [backlog] Session initialized: xyz
🔧 [backlog] Creating new transport for session (reusing shared server)
✅ [backlog] Session initialized: abc
```
**Result:** Single stdio process shared across all sessions

### Parallel Request Test

Tested with 3 simultaneous requests:
```bash
for i in {1..3}; do curl -X POST http://localhost:8081/backlog/mcp ... & done
```

**Logs confirmed:**
- ✅ 3 transports created
- ✅ All reused shared server
- ✅ No new stdio processes spawned
- ✅ No "Starting Stdio Bridge" messages

## Benefits

1. **Single process per segment** - Only one `backlog mcp start` process running
2. **Better performance** - No overhead from spawning/killing processes repeatedly
3. **Stable connections** - stdio process stays alive across sessions
4. **Session isolation** - Each HTTP session has its own transport but shares the server
5. **Eliminates resource contention** - No file locking conflicts in backlog directory
6. **Consistent with HTTP/SSE design** - HTTP MCP servers should handle multiple clients with shared backend

## Testing

### Functionality Test
```bash
bash scripts/test-mcp-flow.sh
```
**Result:** ✅ Task created successfully via MCP endpoint

### Health Check
```bash
curl http://localhost:8081/health | jq '.segments.backlog'
```
**Result:**
```json
{
  "enabled": true,
  "activeSessions": 0,
  "tools": 21,
  "url": "/backlog/mcp"
}
```

### Logs Comparison
- **Old logs:** logs.txt (2036 lines, constant cycling)
- **New logs:** logs-fixed.txt (239 lines in 5 min, stable)

## Commit

```
Fix: Share single stdio process per segment across sessions

Problem:
- Each MCP session was spawning a NEW MCPServer instance
- For bridged segments (backlog, desktop-commander), this spawned
  NEW stdio processes (e.g., "backlog mcp start")
- LiteLLM makes parallel requests, causing 2-3 simultaneous sessions
- This created resource contention and connection cycling

Solution:
- Create ONE MCPServer per segment at startup
- Store shared servers in segmentServers map
- New sessions create only transport, reuse existing server
- Single stdio process per segment (not per session)
```

Commit hash: 33c5034

## Next Steps

The fix is deployed and tested. Monitor logs when using backlog tools through LiteLLM to confirm:
- No more repeated "Creating MCPServer" messages
- Sessions create/close normally without spawning processes
- Backlog operations work reliably with parallel requests
