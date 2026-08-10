FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY tsconfig.base.json ./
RUN npm ci && npm run db:generate && npm run build:packages && npm run build -w @omni/scheduler

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs omnisocial
COPY --from=builder --chown=omnisocial:nodejs /app /app
USER omnisocial
EXPOSE 4102
CMD ["node", "apps/scheduler/dist/main.js"]
