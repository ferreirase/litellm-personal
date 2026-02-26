# ── Stage 1: compilar binário backlog a partir do fonte local ──────────────────
FROM oven/bun:1.2.23-slim AS backlog-builder

WORKDIR /build

# Copiar apenas os arquivos necessários para install + build
COPY Backlog.md/bun.lock ./
COPY Backlog.md/package.json ./
RUN bun install --frozen-lockfile

COPY Backlog.md/ ./
RUN bun build --production --compile --minify --outfile=dist/backlog src/cli.ts

# ── Stage 2: produção ──────────────────────────────────────────────────────────
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 24.x and system deps
RUN apt-get update && apt-get install -y curl ca-certificates gnupg git && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /bin/bash /bin/sh || true

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Copiar binário backlog compilado do stage builder
COPY --from=backlog-builder /build/dist/backlog /usr/local/bin/backlog
RUN chmod +x /usr/local/bin/backlog

# Create workspace directory
RUN mkdir -p /workspace

# Remove dev dependencies for production
RUN npm prune --production

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8081/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Set environment variables
# NODE_BINARY aponta para o node do container (pode ser sobrescrito via compose)
ENV NODE_ENV=production \
    PORT=8081 \
    WORKSPACE_PATH=/workspace \
    LOG_LEVEL=info \
    NODE_BINARY=/usr/bin/node

# Run the server
CMD ["node", "dist/server-simple.js"]
