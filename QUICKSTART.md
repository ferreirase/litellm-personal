# Quick Start Guide

Get up and running with MCP Desktop Commander HTTP Server in under 5 minutes!

## Option 1: Docker (Recommended)

### Step 1: Start the Container

```bash
docker compose up -d
```

### Step 2: Verify It's Running

```bash
# Check health
curl http://localhost:8081/health

# Expected output:
# {"status":"ok","processRunning":true,"pendingRequests":0}
```

### Step 3: Test It

```bash
./test-server.sh
```

That's it! Your server is ready. 🎉

## Option 2: Local Development

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
# Edit .env if needed (optional)
```

### Step 3: Start the Server

```bash
npm run dev
```

### Step 4: Test It

In another terminal:

```bash
./test-server.sh
```

## Using with Claude Code CLI

### Step 1: Add to Claude Code Config

Edit `~/.config/claude-code/config.json`:

```json
{
  "mcpServers": {
    "desktop-commander-http": {
      "url": "http://localhost:8081/mcp"
    }
  }
}
```

### Step 2: Restart Claude Code CLI

```bash
# Claude Code will automatically connect to the server
```

### Step 3: Test from Claude Code

Ask Claude to:

- "List files in my workspace"
- "Read the README.md file"
- "Create a new file called test.txt"

## Quick Commands

### Using Makefile (Easy!)

```bash
make help           # Show all commands
make docker-up      # Start Docker container
make docker-logs    # View logs
make docker-test    # Run tests
make docker-down    # Stop container
```

### Manual Commands

```bash
# Docker
docker compose up -d        # Start
docker compose logs -f      # View logs
docker compose down         # Stop

# Local Development
npm run dev                 # Start with hot reload
npm run build              # Build TypeScript
npm start                  # Start production mode

# Testing
./test-server.sh           # Run tests
curl http://localhost:8081/health  # Health check
```

## Example API Calls

### Initialize MCP Connection

```bash
curl -X POST http://localhost:8081/mcp \
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

### List Available Tools

```bash
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  }'
```

### Read a File

```bash
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {"path": "/workspace/README.md"}
    },
    "id": 3
  }'
```

### Create a Directory

```bash
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_directory",
      "arguments": {"path": "/workspace/new-folder"}
    },
    "id": 4
  }'
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs

# Verify workspace path exists
ls -la /home/ferreirase/Documents
```

### Port Already in Use

```bash
# Change port in .env
echo "PORT=3001" >> .env

# Restart
docker compose down
docker compose up -d
```

### Can't Access Files

```bash
# Check workspace is mounted
docker compose exec mcp-desktop-commander ls -la /workspace

# Verify permissions
chmod -R 755 /home/ferreirase/Documents
```

### Server Not Responding

```bash
# Restart container
docker compose restart

# Or rebuild
make docker-rebuild
```

## Configuration

### Environment Variables

Create `.env` file:

```bash
# Workspace path (host machine)
WORKSPACE_PATH=/home/ferreirase/Documents

# Server port
PORT=8081

# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Request timeout (milliseconds)
REQUEST_TIMEOUT=30000
```

### Custom Workspace

```bash
# Set custom workspace
echo "WORKSPACE_PATH=/path/to/your/files" > .env

# Restart
docker compose down
docker compose up -d
```

## What's Next?

- 📖 Read the full [README.md](README.md) for detailed documentation
- 🛠 Check [CONTRIBUTING.md](CONTRIBUTING.md) for development guide
- 📝 Review [IMPLEMENTATION.md](IMPLEMENTATION.md) for technical details
- 🧪 Run tests with `./test-server.sh`
- 🐛 Report issues on GitHub

## Tips

1. **Use Makefile**: Simplifies common tasks
2. **Check Logs**: `docker compose logs -f` for debugging
3. **Health Check**: Always available at `/health`
4. **Hot Reload**: Use `npm run dev` for development
5. **Test First**: Run `./test-server.sh` after changes

## Summary

```bash
# Fastest way to get started:
docker compose up -d && ./test-server.sh

# Add to Claude Code config and start using!
```

Enjoy! 🚀
