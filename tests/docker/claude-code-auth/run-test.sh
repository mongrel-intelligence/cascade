#!/bin/bash
set -euo pipefail

# Docker auth verification test for Claude Code subscription credentials.
# Reads local ~/.claude/.credentials.json and passes it into a container
# to verify that CLAUDE_CONFIG_DIR-based auth works without volume mounts.

CREDS_FILE="$HOME/.claude/.credentials.json"

if [ ! -f "$CREDS_FILE" ]; then
	echo "Error: $CREDS_FILE not found. Run 'claude login' first."
	exit 1
fi

CREDS=$(cat "$CREDS_FILE")

echo "Building test container..."
docker build -f tests/docker/claude-code-auth/Dockerfile -t cascade-auth-test .

echo "Running auth verification..."
docker run --rm -e "CLAUDE_CREDENTIALS=$CREDS" cascade-auth-test
