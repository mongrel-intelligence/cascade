#!/usr/bin/env bash
# Tests whether .cascade/setup.sh inside a worker container provides enough
# infrastructure to run the full test suite (unit + integration tests).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Use the latest available worker image
WORKER_IMAGE="${WORKER_IMAGE:-ghcr.io/zbigniewsobiecki/cascade-worker:923f7c6215608865ac55e4d89f83663f055ab87a}"

echo "=== Worker Setup Test ==="
echo "Project root : $PROJECT_ROOT"
echo "Worker image : $WORKER_IMAGE"
echo ""

docker run --rm \
  --name cascade-worker-setup-test \
  -v "$PROJECT_ROOT:/workspace/cascade" \
  -e AGENT_PROFILE_NAME=implementation \
  -e CI=true \
  "$WORKER_IMAGE" \
  bash -c '
    set -e
    echo "--- Starting inside worker container ---"
    echo "User: $(id)"
    echo "Node: $(node --version)"
    echo "npm:  $(npm --version)"
    echo ""

    cd /workspace/cascade

    # Run the setup script (installs + starts PostgreSQL and Redis, creates DBs,
    # writes TEST_DATABASE_URL to .cascade/env, runs migrations)
    echo "--- Running .cascade/setup.sh ---"
    bash .cascade/setup.sh
    echo ""

    # Verify .cascade/env has the test DB URL
    echo "--- .cascade/env contents ---"
    cat .cascade/env
    echo ""

    # Run unit tests
    echo "--- Running unit tests ---"
    npm test 2>&1

    echo ""
    echo "--- Running integration tests ---"
    npm run test:integration 2>&1
  '
