FROM node:22-slim

WORKDIR /app

# Install Claude Code CLI globally (SDK spawns it as a subprocess)
RUN npm install -g @anthropic-ai/claude-code

# Copy package files and install dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

# Copy source and test script
COPY tsconfig.json ./
COPY src/ src/
COPY tests/docker/claude-code-auth/verify-auth.ts tests/docker/claude-code-auth/

# Run the verification script with tsx
CMD ["npx", "tsx", "tests/docker/claude-code-auth/verify-auth.ts"]
