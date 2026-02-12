# Dockerfile corrigido para base Alpine
FROM ghcr.io/berriai/litellm:main-latest

USER root

# 1. Instalar dependências usando APK (Alpine Package Keeper)
# Instala Node.js, NPM, Git, Curl, Build-base (equivalente ao build-essential) e Python3/Pip
RUN apk add --no-cache \
    nodejs \
    npm \
    git \
    curl \
    build-base \
    python3 \
    py3-pip

# 2. Instalar UV (Python package manager)
RUN pip install uv --break-system-packages

# 3. Instalar backlog.md globalmente
# No Alpine, npm roda tranquilo como root, mas usamos unsafe-perm para garantir
RUN npm install -g backlog.md --unsafe-perm=true

# 4. Criar diretórios de cache e dar permissão ao usuário litellm
RUN mkdir -p /home/litellm/.npm && \
    mkdir -p /home/litellm/.cache && \
    mkdir -p /home/litellm/.local/share/uv && \
    mkdir -p /home/litellm/.local/bin && \
    chown -R litellm:litellm /home/litellm

# 5. Voltar para o usuário litellm
USER litellm

# 6. Configurar PATH
ENV PATH="/home/litellm/.local/bin:${PATH}"
ENV npm_config_cache="/home/litellm/.npm"
