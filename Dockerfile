FROM node:20-alpine

# Install Python + uv for serena/uvx
RUN apk add --no-cache python3 py3-pip git && \
    pip3 install --break-system-packages uv

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8081
CMD ["node", "dist/index.js"]
