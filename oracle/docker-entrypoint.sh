#!/bin/sh
# Container entrypoint for every oracle process (api, worker, migrate).
#
# The API/worker used to boot straight into Nest and then degrade silently
# ("The table public.posts does not exist") whenever migrations had not been
# applied by hand. Applying them here makes the schema a prerequisite of
# starting, not a runbook step someone can forget.
#
# `prisma migrate deploy` is idempotent and takes a Postgres advisory lock, so
# even if several containers run this at once they serialize instead of racing.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  npx prisma migrate deploy

  # pg_trgm GIN indexes back the posts search but live outside the Prisma
  # schema. Non-fatal: a Postgres role without CREATE EXTENSION rights should
  # still boot (search just falls back to a sequential ILIKE scan).
  echo "[entrypoint] search indexes (pg_trgm)"
  npx prisma db execute --file scripts/pg-trgm.sql --schema prisma/schema.prisma \
    || echo "[entrypoint] WARN: pg_trgm search indexes skipped"
fi

# Run the container's command (Dockerfile CMD, or a compose `command:` override).
exec "$@"
