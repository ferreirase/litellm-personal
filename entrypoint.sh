#!/bin/sh

# Create the .context/.env file for Claude Context MCP
mkdir -p /root/.context
cat <<EOF > /root/.context/.env
EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
EMBEDDING_MODEL=${EMBEDDING_MODEL}
MILVUS_TOKEN=${MILVUS_TOKEN}
VOYAGEAI_API_KEY=${VOYAGEAI_API_KEY}
EOF

# Execute the main process
exec "$@"
