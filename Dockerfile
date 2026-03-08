FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci


FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production && npm install sequelize-cli


FROM node:20-alpine AS runtime
RUN apk add --no-cache graphicsmagick ghostscript wget
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/sequelize.config.cjs ./sequelize.config.cjs
EXPOSE 5002
CMD ["npm", "start"]
