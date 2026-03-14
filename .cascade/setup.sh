#!/bin/bash
set -e

echo "=== CASCADE Project Setup ==="
echo "Agent profile: ${AGENT_PROFILE_NAME:-not set}"

# =============================================================================
# Helper functions
# =============================================================================
log_info() {
  echo "[INFO] $1"
}

log_warn() {
  echo "[WARN] $1"
}

log_error() {
  echo "[ERROR] $1"
}

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

OS=$(detect_os)
log_info "Detected OS: $OS"

# Get the project root directory (parent of .cascade)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
log_info "Project root: $PROJECT_ROOT"

# Change to project root for all subsequent commands
cd "$PROJECT_ROOT"

# =============================================================================
# 0. Prerequisites Check
# =============================================================================
echo ""
echo "--- Checking Prerequisites ---"

# Check for Node.js
if ! command -v node &> /dev/null; then
  log_error "Node.js is not installed"
  exit 1
fi
log_info "Node.js: $(node --version)"

# Check for npm
if ! command -v npm &> /dev/null; then
  log_error "npm is not installed"
  exit 1
fi
log_info "npm: $(npm --version)"

# =============================================================================
# 1. Install Dependencies (only for coding agents)
# =============================================================================
case "$AGENT_PROFILE_NAME" in
  implementation|respond-to-review|review|respond-to-ci)
    echo ""
    echo "--- Installing Dependencies ---"

    # Root dependencies
    log_info "Installing root dependencies..."
    CI=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
    log_info "Root dependencies installed"

    # Frontend dependencies
    log_info "Installing frontend dependencies..."
    cd web && CI=true npm install && cd ..
    log_info "Frontend dependencies installed"
    ;;
  *)
    echo ""
    log_info "Skipping dependency installation (agent: ${AGENT_PROFILE_NAME:-unknown})"
    ;;
esac

# =============================================================================
# 2. PostgreSQL Setup
# =============================================================================
echo ""
echo "--- PostgreSQL Setup ---"

start_postgres_macos() {
  if command -v brew &> /dev/null; then
    # Check which postgresql is installed
    local pg_service=""
    for ver in 17 16 15 14 13; do
      if brew list "postgresql@$ver" &> /dev/null; then
        pg_service="postgresql@$ver"
        break
      fi
    done

    if [ -z "$pg_service" ] && brew list postgresql &> /dev/null; then
      pg_service="postgresql"
    fi

    if [ -z "$pg_service" ]; then
      log_info "PostgreSQL not installed, installing postgresql@16..."
      brew install postgresql@16
      pg_service="postgresql@16"
    fi

    log_info "Using $pg_service"

    # Start the service
    if ! pg_isready -q 2>/dev/null; then
      log_info "Starting PostgreSQL..."
      brew services start "$pg_service" 2>/dev/null || true

      for i in {1..15}; do
        if pg_isready -q 2>/dev/null; then
          break
        fi
        log_info "Waiting for PostgreSQL... ($i/15)"
        sleep 1
      done
    fi
  else
    log_error "Homebrew not found on macOS. Please install PostgreSQL manually."
    return 1
  fi
}

start_postgres_linux() {
  # Check if PostgreSQL SERVER is installed
  local pg_ctl_path
  pg_ctl_path=$(find /usr/lib/postgresql -name pg_ctl 2>/dev/null | head -1 || true)

  if [ -z "$pg_ctl_path" ]; then
    log_info "PostgreSQL server not found, installing..."
    if command -v apt-get &> /dev/null; then
      sudo apt-get update && sudo apt-get install -y postgresql postgresql-client
      local pg_version
      pg_version=$(ls /usr/lib/postgresql/ | sort -V | tail -1)
      log_info "Installed PostgreSQL version: $pg_version"

      if [ ! -d /var/lib/postgresql/data ] || [ -z "$(ls -A /var/lib/postgresql/data 2>/dev/null)" ]; then
        sudo mkdir -p /var/lib/postgresql/data
        sudo chown postgres:postgres /var/lib/postgresql/data
        sudo su postgres -c "/usr/lib/postgresql/$pg_version/bin/initdb -D /var/lib/postgresql/data"
        log_info "PostgreSQL data directory initialized"
      fi
    else
      log_error "Cannot install PostgreSQL - apt-get not available"
      return 1
    fi
  fi

  # Start PostgreSQL if not running
  if ! pg_isready -q 2>/dev/null; then
    log_info "Starting PostgreSQL..."

    local pg_data="/var/lib/postgresql/data"
    local pg_log="/tmp/postgres.log"

    if [ -d "$pg_data" ] && [ -n "$(ls -A "$pg_data" 2>/dev/null)" ]; then
      local pg_ctl
      pg_ctl=$(find /usr/lib/postgresql -name pg_ctl 2>/dev/null | head -1 || echo "pg_ctl")

      # Ensure runtime directory exists
      sudo mkdir -p /run/postgresql 2>/dev/null || true
      sudo chown postgres:postgres /run/postgresql 2>/dev/null || true

      if ! sudo su postgres -c "$pg_ctl status -D $pg_data" 2>&1 | grep -q "server is running"; then
        sudo su postgres -c "$pg_ctl start -D $pg_data -l $pg_log -w" 2>&1 || {
          log_error "pg_ctl start failed"
          cat "$pg_log" 2>/dev/null || true
        }
      fi
    elif command -v pg_ctlcluster &> /dev/null; then
      local cluster_info
      cluster_info=$(pg_lsclusters -h 2>/dev/null | head -1)
      if [ -n "$cluster_info" ]; then
        sudo pg_ctlcluster $(echo "$cluster_info" | awk '{print $1, $2}') start 2>/dev/null || true
      fi
    fi

    # Wait for PostgreSQL to be ready
    for i in {1..15}; do
      if pg_isready -q 2>/dev/null; then
        break
      fi
      log_info "Waiting for PostgreSQL... ($i/15)"
      sleep 1
    done
  fi
}

# Start PostgreSQL based on OS
case "$OS" in
  macos) start_postgres_macos ;;
  linux) start_postgres_linux ;;
  *) log_warn "Unknown OS, skipping PostgreSQL auto-start" ;;
esac

# Verify PostgreSQL is running
if pg_isready -q 2>/dev/null; then
  log_info "PostgreSQL is running"
else
  log_error "PostgreSQL failed to start"
  # Don't exit - let subsequent steps handle the failure gracefully
fi

# =============================================================================
# 3. Create PostgreSQL database
# =============================================================================
if pg_isready -q 2>/dev/null; then
  echo ""
  echo "--- Setting up PostgreSQL database ---"

  # Determine psql command based on OS
  PSQL_CMD="psql"
  if [ "$OS" = "linux" ]; then
    PSQL_CMD="sudo -u postgres psql"
  fi

  # Create cascade database (development)
  if ! $PSQL_CMD -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw cascade; then
    log_info "Creating cascade database..."
    if [ "$OS" = "linux" ]; then
      $PSQL_CMD -c "CREATE DATABASE cascade;" 2>/dev/null || true
    else
      createdb cascade 2>/dev/null || true
    fi
  else
    log_info "Database cascade already exists"
  fi

  # Create cascade_test database (integration tests)
  if ! $PSQL_CMD -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw cascade_test; then
    log_info "Creating cascade_test database..."
    if [ "$OS" = "linux" ]; then
      $PSQL_CMD -c "CREATE DATABASE cascade_test;" 2>/dev/null || true
    else
      createdb cascade_test 2>/dev/null || true
    fi
  else
    log_info "Database cascade_test already exists"
  fi

  # On Linux, ensure postgres user has a known password for app connections
  if [ "$OS" = "linux" ]; then
    $PSQL_CMD -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null || true
  fi

  log_info "PostgreSQL database setup complete"
fi

# =============================================================================
# 4. Create .env for local database (npm scripts use --env-file=.env)
# =============================================================================
if pg_isready -q 2>/dev/null && [ ! -f .env ]; then
  echo ""
  echo "--- Creating .env for local database ---"
  if [ "$OS" = "linux" ]; then
    echo "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cascade" > .env
  else
    echo "DATABASE_URL=postgresql://localhost:5432/cascade" > .env
  fi
  echo "DATABASE_SSL=false" >> .env
  log_info "Created .env with local DATABASE_URL"
fi

# =============================================================================
# 5. Run migrations
# =============================================================================
echo ""
echo "--- Database Migrations ---"

if pg_isready -q 2>/dev/null; then
  if [ "$OS" = "linux" ]; then
    DEV_DB_URL="postgresql://postgres:postgres@localhost:5432/cascade"
    TEST_DB_URL="postgresql://postgres:postgres@localhost:5432/cascade_test"
  else
    DEV_DB_URL="postgresql://localhost:5432/cascade"
    TEST_DB_URL="postgresql://localhost:5432/cascade_test"
  fi

  log_info "Running migrations on cascade (dev)..."
  DATABASE_URL="$DEV_DB_URL" DATABASE_SSL=false npm run db:migrate 2>&1 || \
    log_warn "Migration failed on cascade - may need manual intervention"

  log_info "Running migrations on cascade_test..."
  DATABASE_URL="$TEST_DB_URL" DATABASE_SSL=false npm run db:migrate 2>&1 || \
    log_warn "Migration failed on cascade_test - may need manual intervention"

  # Write TEST_DATABASE_URL to .cascade/env so resolveTestDbUrl() picks up the
  # local postgres in worker containers where Docker is unavailable.
  touch .cascade/env
  if [ "$OS" = "macos" ]; then
    sed -i '' '/^TEST_DATABASE_URL=/d' .cascade/env
  else
    sed -i '/^TEST_DATABASE_URL=/d' .cascade/env
  fi
  echo "TEST_DATABASE_URL=${TEST_DB_URL}" >> .cascade/env
  log_info "Wrote TEST_DATABASE_URL to .cascade/env: ${TEST_DB_URL}"
else
  log_warn "PostgreSQL not ready, skipping migrations"
fi

# =============================================================================
# 6. Redis Setup (required for router mode / BullMQ job queue)
# =============================================================================
echo ""
echo "--- Redis Setup ---"

start_redis_macos() {
  if command -v brew &> /dev/null; then
    if ! brew list redis &> /dev/null; then
      log_info "Redis not installed, installing..."
      brew install redis
    fi
    log_info "Starting Redis..."
    brew services start redis 2>/dev/null || true
    # Wait for Redis to be ready
    for i in {1..10}; do
      if redis-cli ping 2>/dev/null | grep -q PONG; then
        break
      fi
      log_info "Waiting for Redis... ($i/10)"
      sleep 1
    done
  else
    log_error "Homebrew not found on macOS. Please install Redis manually."
    return 1
  fi
}

start_redis_linux() {
  if ! command -v redis-server &> /dev/null; then
    log_info "Redis not installed, installing..."
    if command -v apt-get &> /dev/null; then
      sudo apt-get update && sudo apt-get install -y redis-server
    else
      log_error "Cannot install Redis - apt-get not available"
      return 1
    fi
  fi

  # Start Redis if not running
  if ! redis-cli ping 2>/dev/null | grep -q PONG; then
    log_info "Starting Redis..."
    sudo service redis-server start 2>/dev/null || \
      redis-server --daemonize yes 2>/dev/null || true
    # Wait for Redis to be ready
    for i in {1..10}; do
      if redis-cli ping 2>/dev/null | grep -q PONG; then
        break
      fi
      log_info "Waiting for Redis... ($i/10)"
      sleep 1
    done
  fi
}

case "$OS" in
  macos) start_redis_macos ;;
  linux) start_redis_linux ;;
  *) log_warn "Unknown OS, skipping Redis auto-start" ;;
esac

# Verify Redis is running
if redis-cli ping 2>/dev/null | grep -q PONG; then
  log_info "Redis is running"
else
  log_warn "Redis failed to start — router mode requires Redis for BullMQ job queue"
  log_warn "Run 'redis-server' manually or install Redis before using 'npm run dev'"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=== CASCADE Setup Complete ==="
echo "OS: $OS"
echo "PostgreSQL: $(pg_isready 2>&1 || echo 'not running')"
echo "Redis: $(redis-cli ping 2>/dev/null || echo 'not running')"
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
