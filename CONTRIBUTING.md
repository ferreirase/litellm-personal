# Contributing to MCP Desktop Commander HTTP Server

Thank you for your interest in contributing! This document provides guidelines and instructions for development.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Git

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd mcp-to-server

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Build TypeScript
npm run build
```

## Development Workflow

### Running Locally

```bash
# Start in development mode (with hot reload)
npm run dev

# Or use the helper script
./scripts/start-dev.sh
```

### Running with Docker

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Rebuild everything
./scripts/docker-rebuild.sh

# Test Docker container
./scripts/test-docker.sh
```

### Testing

```bash
# Start the server first (locally or Docker)
npm run dev
# OR
docker compose up -d

# Run tests
./test-server.sh
```

## Project Structure

```
mcp-to-server/
├── src/                      # Source code
│   ├── server.ts             # Main HTTP server
│   ├── bridge.ts             # stdio ↔ HTTP bridge
│   ├── desktop-commander.ts  # Desktop Commander wrapper
│   ├── logger.ts             # Logger implementation
│   └── types.ts              # TypeScript types
├── scripts/                  # Utility scripts
│   ├── start-dev.sh          # Start dev server
│   ├── docker-rebuild.sh     # Rebuild Docker
│   └── test-docker.sh        # Test Docker container
├── dist/                     # Compiled output (generated)
├── test-server.sh            # Test script
├── Dockerfile                # Docker build
├── docker-compose.yml        # Docker Compose config
└── package.json              # Node.js config
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use async/await over callbacks
- Document complex functions with JSDoc comments

### Formatting

```bash
# The project uses default TypeScript formatting
# Make sure your editor respects the tsconfig.json settings
```

### Naming Conventions

- Classes: PascalCase
- Functions/methods: camelCase
- Constants: UPPER_SNAKE_CASE
- Interfaces/Types: PascalCase with descriptive names

## Architecture

### Components

1. **Server** (`server.ts`)
   - Express HTTP server
   - Routes and middleware
   - Request/response handling
   - Entry point

2. **Bridge** (`bridge.ts`)
   - Correlates HTTP requests with stdio responses
   - Manages pending requests
   - Handles timeouts
   - Propagates notifications

3. **Desktop Commander Process** (`desktop-commander.ts`)
   - Manages subprocess lifecycle
   - Handles stdio communication
   - Parses newline-delimited JSON
   - Event emission

4. **Logger** (`logger.ts`)
   - Simple console logging
   - Log level filtering
   - Timestamp formatting

5. **Types** (`types.ts`)
   - TypeScript type definitions
   - JSON-RPC interfaces
   - Type guards

### Data Flow

```
HTTP Request → Express → Server → Bridge → Desktop Commander
                                              ↓
HTTP Response ← Express ← Server ← Bridge ← Desktop Commander
```

## Adding Features

### Adding a New Endpoint

1. Add route in `server.ts` `setupRoutes()` method
2. Implement handler method
3. Add tests
4. Update documentation

### Modifying Bridge Logic

1. Update `bridge.ts`
2. Ensure proper request/response correlation
3. Handle edge cases (timeout, process crash)
4. Add tests

### Changing Desktop Commander Integration

1. Update `desktop-commander.ts`
2. Test subprocess lifecycle
3. Verify message parsing
4. Update configuration if needed

## Testing Guidelines

### Manual Testing

```bash
# Start server
npm run dev

# In another terminal, run tests
./test-server.sh

# Or test individual endpoints
curl -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

### Docker Testing

```bash
# Build and start
docker compose up -d

# Run tests
./scripts/test-docker.sh

# Check logs
docker compose logs -f
```

### What to Test

- [ ] Server starts successfully
- [ ] Health endpoint responds
- [ ] JSON-RPC requests are processed
- [ ] Desktop Commander subprocess starts
- [ ] Requests are forwarded correctly
- [ ] Responses are returned properly
- [ ] Errors are handled gracefully
- [ ] Process cleanup on shutdown

## Common Issues

### Build Errors

```bash
# Clean and rebuild
npm run clean
npm run build
```

### TypeScript Errors

```bash
# Check types
npx tsc --noEmit

# Install missing types
npm install --save-dev @types/<package>
```

### Docker Issues

```bash
# Clean everything
docker compose down
docker system prune -a

# Rebuild
./scripts/docker-rebuild.sh
```

### Desktop Commander Not Starting

Check logs for errors:

```bash
# Local
npm run dev (check console output)

# Docker
docker compose logs -f
```

Common causes:

- Invalid workspace path
- Missing dependencies
- Permission issues

## Pull Request Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
   - Write clean, documented code
   - Follow code style guidelines
   - Add/update tests
4. **Test your changes**
   ```bash
   npm run build
   npm run dev
   ./test-server.sh
   ```
5. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request**
   - Describe your changes
   - Reference any related issues
   - Include test results

## Commit Message Format

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting)
- `refactor:` Code refactoring
- `test:` Adding/updating tests
- `chore:` Maintenance tasks

Examples:

```
feat: add support for batch requests
fix: handle process crash gracefully
docs: update README with new configuration
refactor: simplify bridge request correlation
```

## Questions?

Feel free to:

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Submit a PR for improvements

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
