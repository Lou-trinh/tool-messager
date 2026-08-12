#!/bin/sh
set -eu

npx prisma migrate deploy

if [ -n "${BOOTSTRAP_SUPER_ADMIN_EMAIL:-}" ] || [ -n "${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-}" ]; then
  npx tsx prisma/bootstrap-super-admin.ts
fi

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  npx tsx prisma/seed.ts
fi

exec npx concurrently \
  --kill-others-on-fail \
  --names api,worker,scheduler \
  --prefix-colors blue,magenta,yellow \
  "node apps/api/dist/main.js" \
  "node apps/worker/dist/main.js" \
  "node apps/scheduler/dist/main.js"
