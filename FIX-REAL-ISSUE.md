# Real Backlog MCP Connection Issue - Root Cause and Fix

## The Problem

After deploying the "shared server" fix (commit 6e3661c), the backlog MCP server started failing with:

```
❌ [backlog] Error: Error: Already connected to a transport.
Call close() before connecting to a new transport, or use a separate
Protocol instance per connection.
```

This happened when LiteLLM made parallel requests to the backlog endpoint.

## What Went Wrong with the "Fix"

My previous fix (commit 6e3661c) **misunderstood the architecture**:

### Incorrect Assumption
I thought creating a new `MCPServer` instance spawned a new stdio process, so I tried to share one `MCPServer` across all sessions.

### The Reality
- **StdioBridge spawns the stdio process** - This happens ONCE in `loadTools()` at startup
- **Tools reference the bridge** - Each tool's `execute()` function calls `this.request()` on the shared bridge
- **MCPServer is just a wrapper** - It doesn't spawn processes, it just wraps the tools
- **One transport per server** - MCP SDK's server can only connect to ONE transport at a time

## The Real Architecture

### How Tool Sharing Works

1. **Startup - Create ONE bridge per segment:**
   ```typescript
   bridges[name] = new StdioBridge({
     command: "backlog",
     args: ["mcp", "start"]
   });
   await bridges[name].start(); // ← Spawns ONE stdio process
   ```

2. **Load tools from the bridge:**
   ```typescript
   toolCaches[name] = await bridge.getMastraTools();
   ```

   Each tool looks like:
   ```typescript
   {
     execute: async (input, context) => {
       return await this.request("tools/call", ...); // ← "this" = shared bridge
     }
   }
   ```

3. **Create MCPServer per session:**
   ```typescript
   const server = new MCPServer({
     id: `backlog-${randomUUID()}`,
     tools: toolCaches.backlog, // ← All use the SAME cached tools
   });
   ```

   **Key insight:** Multiple `MCPServer` instances can use the same tool objects. The tools all reference the shared `StdioBridge` instance via closure (`this`).

### Why Parallel Sessions Work

```
Session 1:
  MCPServer_1 → tools (cached) → StdioBridge (shared) → stdio process (single)

Session 2:
  MCPServer_2 → tools (cached) → StdioBridge (shared) → stdio process (single)

Session 3:
  MCPServer_3 → tools (cached) → StdioBridge (shared) → stdio process (single)
```

- Each session gets its own `MCPServer` instance ✓
- Each `MCPServer` can connect to its own transport ✓
- All `MCPServer` instances use the same cached tools ✓
- All tools reference the same `StdioBridge` ✓
- Only ONE stdio process runs ✓

## Why Sharing One MCPServer Failed

```
Attempt with Shared Server:
  MCPServer (single) ← Can only connect to ONE transport

Session 1:
  Transport_1 → MCPServer (connect) ✓

Session 2:
  Transport_2 → MCPServer (connect) ✗ ERROR: Already connected
```

The MCP SDK's server can only maintain ONE active transport connection. When we tried to share one server across sessions, parallel requests failed.

## The Correct Solution

**Revert to the original architecture** - Create MCPServer per session, using cached tools:

```typescript
// At startup - create bridges and cache tools
bridges[name] = new StdioBridge(...);
toolCaches[name] = await bridges[name].getMastraTools();

// Per session - create new server with cached tools
const server = new MCPServer({
  id: `${segmentName}-${randomUUID()}`,
  tools: toolCaches[name], // ← Shared tools
});
const transport = new StreamableHTTPServerTransport(...);
await server.getServer().connect(transport);
```

## Evidence of Fix

### Before (Broken with Shared Server)
```
Session 1: ✓ Connected
Session 2: ✗ Error: Already connected to a transport
```

### After (Fixed with Per-Session Servers)
```
Session 1: 🔧 Creating MCPServer with 21 tools ✓
Session 2: 🔧 Creating MCPServer with 21 tools ✓
Session 3: 🔧 Creating MCPServer with 21 tools ✓
```

All sessions succeed, but still only ONE stdio process runs (verified in earlier testing).

## Key Learnings

1. **Don't optimize prematurely** - The original architecture was correct
2. **Understand the full stack** - I misunderstood where processes were spawned
3. **Tool caching is the real optimization** - Loading tools once and reusing them is sufficient
4. **MCP SDK constraints** - One transport per server is a protocol requirement

## Files Changed

- **src/index.ts** - Reverted to original `createSegmentRoute()` signature
  - Changed back to accept `tools` instead of `server`
  - Create `MCPServer` per session
  - Simplified `initializeSegments()` to just call `createSegmentRoute()`

## Commits

- **6e3661c** - Incorrect "fix" that broke parallel sessions
- **[NEW]** - Revert to correct architecture with per-session servers

## Testing

```bash
# Verify parallel connections work
for i in {1..3}; do
  curl -X POST http://localhost:8081/backlog/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' &
done
```

Logs should show:
```
🔧 [backlog] Creating MCPServer with 21 tools
🔧 [backlog] Creating MCPServer with 21 tools
🔧 [backlog] Creating MCPServer with 21 tools
```

No "Already connected" errors.
