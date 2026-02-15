#!/bin/bash
set -euo pipefail

# Docker auth verification test for Claude Code OAuth token.
# Uses CLAUDE_CODE_OAUTH_TOKEN (generated via `claude setup-token`)
# to verify that subscription auth works in a containerized environment.

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
	echo "Error: CLAUDE_CODE_OAUTH_TOKEN env var is required."
	echo "Generate one with: claude setup-token"
	exit 1
fi

echo "Building test container..."
docker build -f tests/docker/claude-code-auth/Dockerfile -t cascade-auth-test .

echo "Running auth verification..."
docker run --rm -e "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN" cascade-auth-test
