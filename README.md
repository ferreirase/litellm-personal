# MCP Desktop Commander HTTP Server

HTTP wrapper for the Desktop Commander MCP server, allowing access to powerful filesystem, terminal, and process management tools via a RESTful JSON-RPC API.

## Features

- **Filesystem Operations**: Read, write, create, list, and manage files and directories
- **Search Capabilities**: Start and manage file/content searches
- **Code Editing**: Advanced block-based editing
- **Terminal/Process Management**: Start, interact with, and manage processes
- **Configuration**: Get and set Desktop Commander configuration
- **Analytics**: Track usage stats and recent tool calls
- **Docker Ready**: Fully containerized with Docker Compose support
- **Workspace Isolation**: Configurable workspace path for secure file access

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Container                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │         HTTP MCP Server (Express)                │  │
│  │  - JSON-RPC over HTTP                            │  │
│  │  - Port 8081                                      │  │
│  └─────────────┬────────────────────────────────────┘  │
│                │                                        │
│                │ stdio (stdin/stdout)                   │
│                │                                        │
│  ┌─────────────▼────────────────────────────────────┐  │
│  │    Desktop Commander MCP (subprocess)            │  │
│  │  - Stdio communication                           │  │
│  │  - Access to /workspace (volume mounted)         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
                       │
                       │ Volume Mount
                       ▼
         /home/ferreirase/Documents (host)
                 mapped to
              /workspace (container)
```

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)

## Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone <repository-url>
cd mcp-to-server

# Copy environment template
cp .env.example .env

# Edit .env to configure your workspace path
nano .env
```

### 2. Start with Docker Compose

```bash
# Build and start the container
docker compose up -d

# View logs
docker compose logs -f

# Check health
curl http://localhost:8081/health
```

### 3. Test the API

```bash
# Initialize MCP connection
curl -X POST http://localhost:8081/mcp \
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
  }'

# List available tools
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }'

# Read a file
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {
        "path": "/workspace/test.txt"
      }
    },
    "id": 3
  }'
```

## Configuration

### Environment Variables

| Variable          | Description                              | Default                      | Required |
| ----------------- | ---------------------------------------- | ---------------------------- | -------- |
| `WORKSPACE_PATH`  | Host path to mount in container          | `/home/ferreirase/Documents` | No       |
| `PORT`            | HTTP server port                         | `8081`                       | No       |
| `LOG_LEVEL`       | Logging level (debug, info, warn, error) | `info`                       | No       |
| `REQUEST_TIMEOUT` | Request timeout in milliseconds          | `30000`                      | No       |
| `NODE_ENV`        | Node environment                         | `production`                 | No       |

### Configuration File

Create a `.env` file in the project root:

```bash
WORKSPACE_PATH=/path/to/your/workspace
PORT=8081
LOG_LEVEL=info
REQUEST_TIMEOUT=30000
```

## Available Tools

The server exposes all Desktop Commander tools via JSON-RPC:

### Filesystem

- `read_file` - Read file contents
- `read_multiple_files` - Read multiple files at once
- `write_file` - Write/create files
- `create_directory` - Create directories
- `list_directory` - List directory contents
- `move_file` - Move/rename files
- `get_file_info` - Get file metadata

### Search

- `start_search` - Start file/content search
- `get_more_search_results` - Paginate search results
- `stop_search` - Stop active search
- `list_searches` - List all active searches

### Editing

- `edit_block` - Advanced block-based editing

### Terminal/Process

- `start_process` - Start a new process
- `interact_with_process` - Send input to process
- `read_process_output` - Read process output
- `list_processes` - List running processes
- `kill_process` - Gracefully kill process
- `force_terminate` - Force terminate process
- `list_sessions` - List all terminal sessions

### Configuration

- `get_config` - Get configuration
- `set_config_value` - Update configuration

### Analytics

- `get_usage_stats` - Get usage statistics
- `get_recent_tool_calls` - Get recent tool calls
- `give_feedback_to_desktop_commander` - Submit feedback

## Integration with Claude Code CLI

Add to your `~/.config/claude-code/config.json`:

```json
{
  "mcpServers": {
    "desktop-commander-http": {
      "url": "http://localhost:8081/mcp"
    }
  }
}
```

## Local Development

### Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode (with hot reload)
npm run dev

# Run in production mode
npm start
```

### Project Structure

```
mcp-to-server/
├── src/
│   ├── server.ts              # Main HTTP server
│   ├── bridge.ts              # stdio ↔ HTTP bridge
│   ├── desktop-commander.ts   # Desktop Commander subprocess wrapper
│   ├── logger.ts              # Console logger
│   └── types.ts               # TypeScript type definitions
├── dist/                      # Compiled JavaScript (generated)
├── docker-compose.yml         # Docker Compose configuration
├── Dockerfile                 # Docker build configuration
├── package.json               # Node.js dependencies
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Environment variables template
├── .dockerignore              # Docker build exclusions
├── .gitignore                 # Git exclusions
└── README.md                  # This file
```

## API Reference

### JSON-RPC 2.0 Format

All requests must follow JSON-RPC 2.0 specification:

```json
{
  "jsonrpc": "2.0",
  "method": "method_name",
  "params": { "key": "value" },
  "id": 1
}
```

Response format:

```json
{
  "jsonrpc": "2.0",
  "result": { "data": "..." },
  "id": 1
}
```

Error response:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Error message",
    "data": "Additional error data"
  },
  "id": 1
}
```

### Health Check Endpoint

**GET** `/health`

Returns server health status:

```json
{
  "status": "ok",
  "processRunning": true,
  "pendingRequests": 0
}
```

## Docker Commands

```bash
# Build the image
docker compose build

# Start the container
docker compose up -d

# Stop the container
docker compose down

# View logs
docker compose logs -f

# Restart the container
docker compose restart

# Execute commands in container
docker compose exec mcp-desktop-commander sh

# Rebuild and restart
docker compose up -d --build
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Verify workspace path exists
ls -la $WORKSPACE_PATH

# Check permissions
docker compose exec mcp-desktop-commander ls -la /workspace
```

### Permission issues

If you encounter permission errors accessing files:

```bash
# Run as your user (uncomment in docker-compose.yml)
user: "1000:1000"

# Or fix permissions on host
chmod -R 755 /path/to/workspace
```

### Connection refused

```bash
# Verify container is running
docker compose ps

# Check health endpoint
curl http://localhost:8081/health

# Verify port is not in use
lsof -i :8081
```

### Process not responding

```bash
# Check if Desktop Commander subprocess is running
docker compose exec mcp-desktop-commander ps aux

# Restart container
docker compose restart

# View detailed logs
docker compose logs -f --tail=100
```

## Security Considerations

1. **Localhost Only**: Container exposes port only to localhost by default
2. **Workspace Isolation**: Desktop Commander only has access to mounted workspace directory
3. **No Authentication**: This is a local development tool - do not expose to public internet
4. **DNS Rebinding**: Consider adding additional protection if needed
5. **Resource Limits**: Add Docker resource limits in docker-compose.yml if needed

## Performance

- Request timeout: 30 seconds (configurable)
- Supports concurrent requests
- Newline-delimited JSON for efficient stdio parsing
- Stateless HTTP transport for simplicity

## License

MIT

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions:

- Check the [Troubleshooting](#troubleshooting) section
- Review Desktop Commander documentation
- Open an issue on GitHub

## Acknowledgments

- Built on [Desktop Commander MCP](https://github.com/wonderwhy-er/desktop-commander)
- Uses [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- Powered by Node.js, TypeScript, and Express
