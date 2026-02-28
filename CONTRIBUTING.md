# Contributing to Gateway MCP

Thank you for your interest in contributing! This document provides guidelines and instructions for development.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Git

### Initial Setup

```bash
git clone <repository-url>
cd gateway-mcp

npm install
cp .env.example .env
npm run build
```

## Development Workflow

### Running Locally

```bash
npm run dev   # Start with hot reload
```

### Running with Docker

```bash
docker compose up -d
docker compose logs -f
```

## Project Structure

```
gateway-mcp/
├── src/
│   ├── server-simple.ts   # Main HTTP gateway server
│   └── logger.ts          # Logger implementation
├── dist/                  # Compiled output (generated)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Architecture

### Components

1. **Server** (`server-simple.ts`)
   - Express HTTP gateway
   - Spawns and manages MCP server subprocesses via stdio
   - Routes requests to per-server endpoints (`/mcp/<server-name>`)
   - Health check endpoint

2. **Logger** (`logger.ts`)
   - Simple console logging with configurable log levels

### Data Flow

```
HTTP Request → Express → /mcp/<server-name> → stdio → MCP subprocess
                                                          ↓
HTTP Response ← Express ←──────────────────── stdio ← MCP subprocess
```

## Code Style

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use async/await over callbacks

## Commit Message Format

Follow conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
