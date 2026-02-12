# Usa uma imagem que JÁ TEM Python e Node instalados
FROM nikolaik/python-nodejs:python3.11-nodejs20

USER root

# Instalar ferramentas essenciais (se o apt falhar, pelo menos já temos node/python)
# Usamos "|| true" para não quebrar o build se o DNS falhar no apt-get
RUN apt-get update && \
    apt-get install -y git build-essential libpq-dev || echo "Apt-get failed, continuing anyway..."

# Instalar UV
RUN pip install uv --no-cache-dir

# Instalar LiteLLM (com proxy) e dependências
RUN pip install --no-cache-dir litellm[proxy] psycopg2-binary

# Instalar backlog globalmente
RUN npm install -g backlog.md --unsafe-perm=true

# Preparar usuário litellm (a imagem nikolaik já tem usuário pn, vamos criar o litellm)
RUN useradd -m -s /bin/bash litellm

# Preparar diretórios
RUN mkdir -p /home/litellm/.npm && \
    mkdir -p /home/litellm/.cache && \
    mkdir -p /home/litellm/.local/bin && \
    chown -R litellm:litellm /home/litellm

USER litellm
ENV PATH="/home/litellm/.local/bin:${PATH}"
WORKDIR /home/litellm

# Comando de entrada
CMD ["litellm", "--port", "4000"]
