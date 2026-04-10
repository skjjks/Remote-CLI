FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:18-alpine
RUN apk add --no-cache tmux bash
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY .env.example .env.example

# Create data directory for session persistence
RUN mkdir -p /app/data

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
