# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-17

### Added
- Initial release of MCP Desktop Commander HTTP Server
- HTTP wrapper for Desktop Commander MCP server
- Express-based JSON-RPC 2.0 API server
- stdio ↔ HTTP bridge with request correlation
- Desktop Commander subprocess management
- Comprehensive TypeScript type definitions
- Docker support with multi-stage build
- Docker Compose orchestration
- Health check endpoint
- Request timeout handling (30s default)
- Graceful shutdown handling
- Newline-delimited JSON parsing with buffering
- Event-driven architecture for subprocess communication
- Console logger with configurable log levels
- Environment variable configuration
- Volume mounting for workspace access
- CORS support (localhost only)
- Batch request support
- Comprehensive error handling
- Development mode with hot reload
- Production build optimization
- Test suite (`test-server.sh`)
- Helper scripts:
  - `scripts/start-dev.sh` - Development server
  - `scripts/docker-rebuild.sh` - Docker rebuild
  - `scripts/test-docker.sh` - Docker testing
- Makefile for common commands
- Complete documentation:
  - README.md - User guide
  - QUICKSTART.md - Quick start guide
  - CONTRIBUTING.md - Developer guide
  - IMPLEMENTATION.md - Technical details
- Configuration examples:
  - `.env.example` - Environment variables
  - `claude-code-config.example.json` - Claude Code integration
- `.gitignore` for version control
- `.dockerignore` for optimized builds

### Supported Desktop Commander Tools
- Filesystem operations (read, write, create, list, move, info)
- Search capabilities (start, get results, stop, list)
- Block-based editing
- Terminal/process management (start, interact, read, list, kill)
- Configuration management (get, set)
- Analytics (usage stats, recent calls, feedback)

### Technical Details
- Node.js 20+ runtime
- TypeScript with strict mode
- Express 4.x HTTP framework
- MCP SDK integration
- ES2022 target with NodeNext modules
- Source maps for debugging
- Declaration maps for IDE support
- Health checks for container orchestration
- Automatic process restart on failure
- Clean separation of concerns (Server, Bridge, Process, Logger)

### Security
- Localhost-only CORS policy
- Workspace isolation via Docker volumes
- No authentication (designed for local development)
- DNS rebinding protection ready
- Non-root user support (optional)

### Performance
- Async/await throughout
- Efficient Map-based request tracking
- Low memory overhead
- Minimal CPU usage when idle
- Fast startup time (~2s)

### Developer Experience
- Hot reload in development
- Comprehensive test coverage
- Clear error messages
- Structured logging
- Type safety with TypeScript
- Detailed documentation
- Helper scripts and Makefile
- Docker for consistent environments

## [Unreleased]

### Planned Features
- WebSocket transport option
- Session management (stateful mode)
- Authentication/authorization
- Rate limiting
- Prometheus metrics
- Multiple workspace support
- Response caching
- Request queuing
- Structured JSON logging
- CLI tool for management

---

[1.0.0]: https://github.com/yourusername/mcp-to-server/releases/tag/v1.0.0
