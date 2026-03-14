#!/bin/bash
set -e

# Source .env so bash has access to user-configured vars (ports, passwords).
# Docker Compose reads .env automatically, but bash does not.
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "==> Building CASCADE images..."
docker compose build
docker compose --profile build-only build worker

echo "==> Running database migrations..."
docker compose --profile setup run --rm migrate

echo "==> Starting CASCADE..."
docker compose up -d

DASHBOARD_PORT=${DASHBOARD_PORT:-3001}
echo ""
echo "CASCADE is running!"
echo "  Dashboard: http://localhost:${DASHBOARD_PORT}"
echo ""
echo "Next: create an admin user:"
echo "  docker compose exec dashboard node dist/tools/create-admin-user.mjs \\"
echo "    --email admin@example.com --password changeme --name \"Admin\""
