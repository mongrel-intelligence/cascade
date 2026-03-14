#!/bin/bash
# Service health check and restart for CASCADE agent
# Can be run by the agent before running tests or migrations
#
# Usage: .cascade/ensure-services.sh
# Exit codes:
#   0 - All services running
#   1 - Service failed to start

set -e

echo "=== Checking Services ==="

# PostgreSQL check and restart
if pg_isready -q 2>/dev/null; then
  echo "PostgreSQL: running"
else
  echo "PostgreSQL: down - attempting restart..."

  if [ -d /var/lib/postgresql/data ]; then
    PG_CTL=$(find /usr/lib/postgresql -name pg_ctl 2>/dev/null | head -1)
    if [ -n "$PG_CTL" ]; then
      echo "Found pg_ctl at: $PG_CTL"

      mkdir -p /run/postgresql 2>/dev/null || true
      chown postgres:postgres /run/postgresql 2>/dev/null || true

      if su postgres -c "$PG_CTL start -D /var/lib/postgresql/data -l /tmp/postgres.log -w -t 30" 2>/dev/null; then
        echo "Started PostgreSQL as postgres user"
      elif $PG_CTL start -D /var/lib/postgresql/data -l /tmp/postgres.log -w -t 30 2>/dev/null; then
        echo "Started PostgreSQL as current user"
      elif command -v pg_ctlcluster &>/dev/null; then
        PG_VERSION=$(ls /usr/lib/postgresql/ | sort -V | tail -1)
        pg_ctlcluster $PG_VERSION main start 2>/dev/null || true
      else
        echo "PostgreSQL restart failed - needs manual intervention"
        echo "Try: su postgres -c 'pg_ctl start -D /var/lib/postgresql/data'"
      fi
    fi
  elif command -v brew &>/dev/null; then
    brew services start postgresql@16 2>/dev/null || \
      brew services start postgresql@15 2>/dev/null || \
      brew services start postgresql 2>/dev/null || true
  fi

  # Wait for PostgreSQL to be ready
  for i in {1..10}; do
    if pg_isready -q 2>/dev/null; then
      break
    fi
    echo "Waiting for PostgreSQL... ($i/10)"
    sleep 1
  done

  # Final check
  if pg_isready -q 2>/dev/null; then
    echo "PostgreSQL: restarted successfully"
  else
    echo "PostgreSQL: FAILED TO START"
    echo ""
    echo "Troubleshooting:"
    echo "  - Check PostgreSQL logs: cat /tmp/postgres.log"
    echo "  - Check data directory: ls -la /var/lib/postgresql/data"
    echo "  - Check if another instance is running: ps aux | grep postgres"
    exit 1
  fi
fi

# Verify test database exists (needed for integration tests)
if pg_isready -q 2>/dev/null; then
  # OS-aware psql command (macOS uses peer auth, Linux uses -U postgres)
  case "$(uname -s)" in
    Linux*)  PSQL_CMD="psql -U postgres" ;;
    *)       PSQL_CMD="psql" ;;
  esac

  if $PSQL_CMD -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw cascade_test; then
    echo "Test database (cascade_test): exists"
  else
    echo "Test database (cascade_test): missing - creating..."
    if [ "$(uname -s)" = "Linux" ]; then
      $PSQL_CMD -c "CREATE DATABASE cascade_test;" 2>/dev/null || true
    else
      createdb cascade_test 2>/dev/null || true
    fi
    if $PSQL_CMD -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw cascade_test; then
      echo "Test database (cascade_test): created"
    else
      echo "Test database (cascade_test): FAILED TO CREATE (integration tests will not work)"
    fi
  fi
fi

# Redis check and restart (required for router mode / BullMQ job queue)
if redis-cli ping 2>/dev/null | grep -q PONG; then
  echo "Redis: running"
else
  echo "Redis: down - attempting restart..."

  if command -v brew &>/dev/null; then
    brew services start redis 2>/dev/null || true
  elif command -v service &>/dev/null; then
    sudo service redis-server start 2>/dev/null || \
      redis-server --daemonize yes 2>/dev/null || true
  elif command -v redis-server &>/dev/null; then
    redis-server --daemonize yes 2>/dev/null || true
  fi

  # Wait for Redis to be ready
  for i in {1..10}; do
    if redis-cli ping 2>/dev/null | grep -q PONG; then
      break
    fi
    echo "Waiting for Redis... ($i/10)"
    sleep 1
  done

  # Final check
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "Redis: restarted successfully"
  else
    echo "Redis: FAILED TO START"
    echo ""
    echo "Troubleshooting:"
    echo "  - Install Redis: brew install redis (macOS) or apt-get install redis-server (Linux)"
    echo "  - Start manually: redis-server"
    echo "  - Note: Redis is required for router mode (BullMQ job queue)"
    exit 1
  fi
fi

echo "=== All services running ==="
