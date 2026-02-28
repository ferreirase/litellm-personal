# Quick Start Guide

Get up and running with Gateway MCP in under 5 minutes!

## Option 1: Docker (Recommended)

### Step 1: Start the Container

```bash
docker compose up -d
```

### Step 2: Verify It's Running

```bash
curl http://localhost:8085/health
```

### Step 3: Test an MCP Server

```bash
curl -X POST http://localhost:8085/mcp/sequential-thinking \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    },
    "id": 1
  }'
```

## Option 2: Local Development

```bash
npm install
npm run dev
```

## Using with Claude Code CLI

Edit `~/.config/claude-code/config.json`:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "url": "http://localhost:8085/mcp/sequential-thinking"
    },
    "backlog": {
      "url": "http://localhost:8085/mcp/backlog"
    }
  }
}
```

Restart Claude Code CLI and you're ready to go.

## Quick Commands

```bash
docker compose up -d        # Start
docker compose logs -f      # View logs
docker compose down         # Stop
npm run dev                 # Local dev with hot reload
npm run build               # Build TypeScript
npm start                   # Production mode
```

## Configuration

Create `.env` file:

```bash
WORKSPACE_PATH=/home/ferreirase/Documents
PORT=8085
LOG_LEVEL=info
```
