#!/bin/sh
set -eu

npx prisma migrate deploy

if [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  npx tsx prisma/seed.ts
fi

exec npx concurrently \
  --kill-others-on-fail \
  --names api,worker,scheduler \
  --prefix-colors blue,magenta,yellow \
  "node apps/api/dist/main.js" \
  "node apps/worker/dist/main.js" \
  "node apps/scheduler/dist/main.js"
