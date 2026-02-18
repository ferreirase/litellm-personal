FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 24.x and system deps
RUN apt-get update && apt-get install -y curl ca-certificates gnupg git && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

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

# Install global MCP CLIs
RUN npm i -g backlog.md
RUN npm i -g @modelcontextprotocol/server-sequential-thinking

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
ENV NODE_ENV=production \
    PORT=8081 \
    WORKSPACE_PATH=/workspace \
    LOG_LEVEL=info

# Run the server
CMD ["node", "dist/server-simple.js"]
