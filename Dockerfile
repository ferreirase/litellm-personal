# Dockerfile
FROM ghcr.io/berriai/litellm:main-latest

USER root

# 1. Instalação limpa de dependências e Node.js 20
RUN apt-get update && \
    apt-get install -y curl gnupg git build-essential && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean

# 2. Instala UV (Python package manager)
RUN pip install uv --break-system-packages

# 3. Cria diretórios e ajusta permissões ANTES de voltar para o usuário litellm
RUN mkdir -p /home/litellm/.npm && \
    mkdir -p /home/litellm/.cache && \
    mkdir -p /home/litellm/.local/share/uv && \
    mkdir -p /home/litellm/.local/bin && \
    chown -R litellm:litellm /home/litellm

# 4. Instala backlog localmente para o usuário (evita erro de root/permission denied)
USER litellm
RUN npm config set prefix '/home/litellm/.local'
RUN npm install -g backlog.md

# 5. Configura o PATH para encontrar os binários locais
ENV PATH="/home/litellm/.local/bin:${PATH}"
ENV npm_config_cache="/home/litellm/.npm"
