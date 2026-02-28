# Project Status

## Current Architecture

Gateway MCP is an HTTP proxy that exposes multiple MCP servers over HTTP endpoints.

### Source Files

| File | Description | Status |
|------|-------------|--------|
| `src/server-simple.ts` | Main HTTP gateway server | Active |
| `src/logger.ts` | Console logger with log levels | Active |

### Supported MCP Servers

- **sequential-thinking** - Available at `/mcp/sequential-thinking`
- **backlog** - Available at `/mcp/backlog`

### Infrastructure

- Docker multi-stage build (Bun for backlog binary, Node.js 24 for production)
- Health check at `/health`
- Port 8085 (configurable)

## Version

**Version**: 1.0.0
**Last Updated**: February 2026
