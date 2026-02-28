# Gateway MCP - HTTP Proxy for MCP Servers

HTTP proxy that exposes multiple MCP (Model Context Protocol) servers over HTTP, allowing access via RESTful JSON-RPC API. Each upstream MCP server gets its own HTTP endpoint.

## Features

- **Multi-Server Proxy**: Route requests to multiple MCP servers through a single HTTP gateway
- **Per-Server Endpoints**: Each MCP server is available at `/mcp/<server-name>`
- **Dynamic Server Discovery**: Automatically spawns and manages MCP server subprocesses
- **Docker Ready**: Fully containerized with Docker Compose support
- **Health Monitoring**: Health check endpoint at `/health`

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Docker Container                      │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │       HTTP Gateway (Express - server-simple.ts)    │  │
│  │  - JSON-RPC over HTTP                              │  │
│  │  - Port 8085                                        │  │
│  │  - Routes: /mcp/<server-name>                       │  │
│  └──────┬──────────────────────────────┬──────────────┘  │
│         │ stdio                        │ stdio            │
│  ┌──────▼──────────┐   ┌──────────────▼──────────────┐  │
│  │  sequential-     │   │  backlog                     │  │
│  │  thinking (MCP)  │   │  (MCP subprocess)            │  │
│  └──────────────────┘   └──────────────────────────────┘  │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd gateway-mcp

cp .env.example .env
# Edit .env to configure your workspace path
```

### 2. Start with Docker Compose

```bash
docker compose up -d
docker compose logs -f
curl http://localhost:8085/health
```

### 3. Test the API

```bash
# Initialize MCP connection (sequential-thinking server)
curl -X POST http://localhost:8085/mcp/sequential-thinking \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "test-client", "version": "1.0.0" }
    },
    "id": 1
  }'

# List available tools
curl -X POST http://localhost:8085/mcp/sequential-thinking \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}'
```

## Configuration

### Environment Variables

| Variable          | Description                              | Default                      | Required |
| ----------------- | ---------------------------------------- | ---------------------------- | -------- |
| `WORKSPACE_PATH`  | Host path to mount in container          | `/home/ferreirase/Documents` | No       |
| `PORT`            | HTTP server port                         | `8085`                       | No       |
| `LOG_LEVEL`       | Logging level (debug, info, warn, error) | `info`                       | No       |
| `NODE_ENV`        | Node environment                         | `production`                 | No       |

## Integration with Claude Code CLI

Add to your `~/.config/claude-code/config.json`:

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

## Local Development

### Setup

```bash
npm install
npm run build
npm run dev    # development mode with hot reload
npm start      # production mode
```

### Project Structure

```
gateway-mcp/
├── src/
│   ├── server-simple.ts   # Main HTTP gateway server
│   └── logger.ts          # Console logger
├── dist/                  # Compiled JavaScript (generated)
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Docker Commands

```bash
docker compose up -d          # Start
docker compose down            # Stop
docker compose logs -f         # View logs
docker compose restart         # Restart
docker compose up -d --build   # Rebuild and restart
```

## Troubleshooting

### Container won't start

```bash
docker compose logs
ls -la $WORKSPACE_PATH
```

### Connection refused

```bash
docker compose ps
curl http://localhost:8085/health
lsof -i :8085
```

## Security Considerations

1. **Localhost Only**: Container exposes port only to localhost by default
2. **No Authentication**: This is a local development tool - do not expose to public internet

## License

MIT

## Acknowledgments

- Uses [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- Powered by Node.js, TypeScript, and Express
