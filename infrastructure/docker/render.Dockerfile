FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/scheduler/package.json apps/scheduler/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
COPY prisma ./prisma
COPY tsconfig.base.json ./

RUN npm ci

COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/scheduler ./apps/scheduler

RUN npm run db:generate \
  && npm run build:packages \
  && npm run build -w @omni/api \
  && npm run build -w @omni/worker \
  && npm run build -w @omni/scheduler

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs omnisocial

COPY --from=builder --chown=omnisocial:nodejs /app /app
COPY --chown=omnisocial:nodejs infrastructure/docker/render-entrypoint.sh /app/infrastructure/docker/render-entrypoint.sh

USER omnisocial
EXPOSE 10000

CMD ["sh", "/app/infrastructure/docker/render-entrypoint.sh"]
