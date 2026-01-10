FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (including dev for build)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image - uses niu-browser-base which has Playwright and Camoufox pre-installed
FROM zbigniew1/niu-browser-base:latest AS production
WORKDIR /app

# Install pnpm globally (some repos use it)
RUN npm install -g pnpm --force

# Install additional tools not in niu-browser-base
# (niu-browser-base already has: git, curl, ca-certificates, gnupg, postgresql-client)
RUN apt-get update && apt-get install -y \
    fd-find \
    ripgrep \
    ed \
    unzip \
    lsof \
    procps \
    psutils \
    tmux \
    postgresql \
    sudo \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s $(which fdfind) /usr/local/bin/fd

# Configure tmux to keep panes alive after command exits
# This allows capturing output and exit code from fast-exiting commands
RUN echo "set-option -g remain-on-exit on" > /root/.tmux.conf

# Add PostgreSQL binaries to PATH so agents can use pg_ctl, psql, etc.
ENV PATH="/usr/lib/postgresql/18/bin:$PATH"

# Configure PostgreSQL for local development use by agents
# - User: postgres, Password: postgres
# - Connection: postgresql://postgres:postgres@localhost:5432/postgres
RUN mkdir -p /run/postgresql && chown -R postgres:postgres /run/postgresql \
    && mkdir -p /var/lib/postgresql/data && chown -R postgres:postgres /var/lib/postgresql \
    && su postgres -c "/usr/lib/postgresql/*/bin/initdb -D /var/lib/postgresql/data" \
    && { \
        echo "# PostgreSQL Client Authentication Configuration"; \
        echo "# TYPE  DATABASE  USER  ADDRESS  METHOD"; \
        echo "local   all       all            trust"; \
        echo "host    all       all   127.0.0.1/32  md5"; \
        echo "host    all       all   ::1/128       md5"; \
        echo "host    all       all   0.0.0.0/0     md5"; \
    } > /var/lib/postgresql/data/pg_hba.conf \
    && chown postgres:postgres /var/lib/postgresql/data/pg_hba.conf \
    && su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl start -D /var/lib/postgresql/data -l /tmp/postgres.log -w" \
    && su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\"" \
    && su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl stop -D /var/lib/postgresql/data"

# Install ast-grep
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then AST_ARCH="x86_64"; else AST_ARCH="aarch64"; fi && \
    curl -L "https://github.com/ast-grep/ast-grep/releases/download/0.40.3/app-${AST_ARCH}-unknown-linux-gnu.zip" -o /tmp/ast-grep.zip && \
    unzip /tmp/ast-grep.zip -d /usr/local/bin && \
    rm /tmp/ast-grep.zip && \
    chmod +x /usr/local/bin/sg

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Browsers (Playwright Chromium, Camoufox) are pre-installed in niu-browser-base

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Copy Eta template files (not handled by TypeScript compiler)
COPY src/agents/prompts/templates ./dist/agents/prompts/templates

# Copy config
COPY config ./config

# Create workspace directory for repos and logs
RUN mkdir -p /workspace

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]

