
FROM node:22-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git ca-certificates python3 python3-pip curl && \
    npm install -g backlog.md && \
    # Install UV for Serena
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

# Setup Claude Context directory
RUN mkdir -p /root/.context

# Mark all directories under /data as safe for git
RUN git config --global --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN chmod +x entrypoint.sh
RUN npm run build

# Default environment variables
ENV PORT=8081
ENV HOST_ROOT=/home/ferreirase/Documents
ENV BASE_URL=http://localhost:8081

EXPOSE 8081

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
