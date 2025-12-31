FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (including dev for build)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image
FROM node:22-slim AS production
WORKDIR /app

# Install system dependencies
# Added: lsof, procps (for pkill), psutils, tmux (for shell command execution)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    fd-find \
    ripgrep \
    ed \
    unzip \
    lsof \
    procps \
    psutils \
    tmux \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s $(which fdfind) /usr/local/bin/fd

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

# Pre-fetch camoufox browser binaries to speed up npm install for repos that use it
RUN npm install -g camoufox-js \
    && npx camoufox-js fetch \
    && npm uninstall -g camoufox-js

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Copy Eta template files (not handled by TypeScript compiler)
COPY src/agents/prompts/templates ./dist/agents/prompts/templates

# Copy config
COPY config ./config

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]

