FROM node:22-bookworm-slim AS deps
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    PUBLIC_DIR=/app/public \
    DB_PATH=/app/backend/data/ceremesiz.db

WORKDIR /app/backend

COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/private ./private
COPY index.html /app/public/index.html
COPY favicon.png /app/public/favicon.png

RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
