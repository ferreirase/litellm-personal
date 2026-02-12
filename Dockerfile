FROM ghcr.io/berriai/litellm:main-stable
RUN apk add --no-cache nodejs npm
WORKDIR /app
