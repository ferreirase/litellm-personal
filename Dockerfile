# 1. Usar imagem Python oficial robusta (Debian Bookworm)
FROM python:3.11-slim-bookworm

# Evita perguntas durante instalação
ENV DEBIAN_FRONTEND=noninteractive

# 2. Instalar dependências do sistema (Node, Git, Build tools)
RUN apt-get update && \
    apt-get install -y \
    curl \
    gnupg \
    git \
    build-essential \
    libpq-dev && \
    # Instalar Node.js 20
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 3. Instalar LiteLLM e suas dependências (incluindo suporte a banco e proxy)
RUN pip install --no-cache-dir \
    litellm[proxy] \
    uv \
    psycopg2-binary

# 4. Instalar o backlog globalmente via npm
RUN npm install -g backlog.md --unsafe-perm=true

# 5. Criar usuário não-root para segurança
RUN useradd -m -s /bin/bash litellm

# 6. Preparar diretórios
RUN mkdir -p /home/litellm/.npm && \
    mkdir -p /home/litellm/.cache && \
    chown -R litellm:litellm /home/litellm

# 7. Configurar ambiente
USER litellm
ENV PATH="/home/litellm/.local/bin:${PATH}"
WORKDIR /home/litellm

# 8. Comando de entrada (Igual ao da imagem oficial)
CMD ["litellm", "--port", "4000"]
