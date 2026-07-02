FROM node:20-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci


FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production && npm install sequelize-cli --no-save


FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphicsmagick \
    ghostscript \
    wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/sequelize.config.cjs ./sequelize.config.cjs

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget -q -O- "http://127.0.0.1:5002/api/health" > /dev/null || exit 1

CMD ["npm", "start"]
