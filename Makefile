.PHONY: help install build dev start test clean docker-build docker-up docker-down docker-logs docker-test docker-rebuild

# Default target
help:
	@echo "MCP Desktop Commander HTTP Server - Available commands:"
	@echo ""
	@echo "  make install        - Install dependencies"
	@echo "  make build          - Build TypeScript"
	@echo "  make dev            - Start development server"
	@echo "  make start          - Start production server"
	@echo "  make test           - Run tests (requires server running)"
	@echo "  make clean          - Clean build artifacts"
	@echo ""
	@echo "Docker commands:"
	@echo "  make docker-build   - Build Docker image"
	@echo "  make docker-up      - Start Docker container"
	@echo "  make docker-down    - Stop Docker container"
	@echo "  make docker-logs    - View Docker logs"
	@echo "  make docker-test    - Test Docker container"
	@echo "  make docker-rebuild - Rebuild and restart Docker"
	@echo ""

# Install dependencies
install:
	npm install

# Build TypeScript
build:
	npm run build

# Start development server
dev:
	./scripts/start-dev.sh

# Start production server
start:
	npm start

# Run tests
test:
	./test-server.sh

# Clean build artifacts
clean:
	npm run clean
	rm -rf node_modules

# Docker commands
docker-build:
	docker compose build

docker-up:
	docker compose up -d
	@echo ""
	@echo "Container started! View logs with: make docker-logs"
	@echo "Health check: http://localhost:8081/health"

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-test:
	./scripts/test-docker.sh

docker-rebuild:
	./scripts/docker-rebuild.sh

# All-in-one commands
all: install build

docker-all: docker-rebuild docker-test
