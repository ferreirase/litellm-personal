FROM ghcr.io/berriai/litellm:main-python
RUN apt-get update && apt-get install -y nodejs npm curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
