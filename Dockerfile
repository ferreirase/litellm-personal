FROM node:20-slim

# Install git and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    npm install -g backlog.md && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Mark all directories under /data as safe for git
RUN git config --global --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Default environment variables
ENV PORT=8081
ENV HOST_ROOT=/home/ferreirase/Documents
ENV BASE_URL=http://localhost:8081

EXPOSE 8081

CMD ["node", "dist/index.js"]
