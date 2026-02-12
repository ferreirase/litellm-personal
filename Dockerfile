# Usa a imagem oficial do LiteLLM como base
FROM ghcr.io/berriai/litellm:main-latest

# Muda para root para instalar dependências do sistema
USER root

# 1. Instala dependências básicas, Node.js 20, Git e ferramentas de build
RUN apt-get update && \
    apt-get install -y curl gnupg build-essential && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs git && \
    apt-get clean

# 2. Instala UV (gerenciador python rápido para o MCP serena)
RUN pip install uv

# 3. Instala o backlog.md globalmente (para o comando 'backlog' funcionar)
RUN npm install -g backlog.md

# 4. Prepara diretórios de cache e permissões para o usuário 'litellm'
# Isso evita erros de permissão ao rodar npx/uvx
RUN mkdir -p /home/litellm/.npm && \
    mkdir -p /home/litellm/.cache && \
    mkdir -p /home/litellm/.local/share/uv && \
    chown -R litellm:litellm /home/litellm

# Volta para o usuário padrão
USER litellm

# Adiciona binários locais ao PATH (caso instale algo localmente)
ENV PATH="/home/litellm/.local/bin:${PATH}"
ENV npm_config_cache="/home/litellm/.npm"
