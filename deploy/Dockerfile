FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/arena.ts ./scripts/arena.ts
COPY artifacts ./artifacts
RUN mkdir -p /data/arena && chown -R node:node /data/arena
USER node
ENV ARENA_NETWORK=chipnet ARENA_HOSTED=1 ARENA_BIND=0.0.0.0 ARENA_DATA_DIR=/data/arena
EXPOSE 3100
CMD ["node","--import","tsx","scripts/arena.ts","/data/arena/config.json"]
