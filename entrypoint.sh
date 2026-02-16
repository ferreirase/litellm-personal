#!/bin/sh

# Create the .context/.env file for Claude Context MCP
mkdir -p /root/.context
cat <<EOF > /root/.context/.env
EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
EMBEDDING_MODEL=${EMBEDDING_MODEL}
MILVUS_TOKEN=${MILVUS_TOKEN}
VOYAGEAI_API_KEY=${VOYAGEAI_API_KEY}
EOF
 
# Initialize Backlog.md if not already initialized
if [ ! -d "/data/backlog" ]; then
    echo "📝 Initializing Backlog.md project..."
    cd /data
    git init -q 2>/dev/null || true
    backlog init "MCP Gateway" --defaults 2>&1 | grep -v "^hint:"
    echo "✅ Backlog.md initialized successfully"
else
    echo "✅ Backlog.md already initialized, skipping..."
fi
 
# Execute of main process
exec "$@"
