FROM node:22-slim AS base
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    fd-find \
    ripgrep \
    ed \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s $(which fdfind) /usr/local/bin/fd

# Install ast-grep
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then AST_ARCH="x86_64"; else AST_ARCH="aarch64"; fi && \
    curl -L "https://github.com/ast-grep/ast-grep/releases/latest/download/ast-grep-${AST_ARCH}-unknown-linux-gnu.zip" -o /tmp/ast-grep.zip && \
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

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Copy config
COPY config ./config

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
