#!/bin/bash
# Post-edit validation for CASCADE agent
# Runs linting and type checking on edited files
#
# Usage: .cascade/on-file-edit.sh <file-path>
#
# Exit codes:
#   0  - All checks passed (or file type not applicable)
#   1  - Lint errors found
#   2  - Type errors found
#   3  - Both lint and type errors found
#   10 - File not found
#   11 - No file path provided

set -uo pipefail

FILE_PATH="${1:-}"

if [ -z "$FILE_PATH" ]; then
  echo "Error: No file path provided"
  echo "Usage: $0 <file-path>"
  exit 11
fi

# Convert to absolute path if relative
if [[ ! "$FILE_PATH" = /* ]]; then
  FILE_PATH="$(pwd)/$FILE_PATH"
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "Error: File not found: $FILE_PATH"
  exit 10
fi

# Get the project root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Make file path relative to project root
REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

# Get file extension
EXT="${FILE_PATH##*.}"

# Determine if file is lintable and/or type-checkable
LINT_APPLICABLE=false
TYPE_APPLICABLE=false

case "$EXT" in
  ts|tsx)
    LINT_APPLICABLE=true
    TYPE_APPLICABLE=true
    ;;
  js|jsx|json|jsonc)
    LINT_APPLICABLE=true
    ;;
esac

# If neither applies, exit successfully
if [ "$LINT_APPLICABLE" = false ] && [ "$TYPE_APPLICABLE" = false ]; then
  exit 0
fi

LINT_EXIT=0
TYPE_EXIT=0
LINT_OUTPUT=""
TYPE_OUTPUT=""

# --- Run Biome lint ---
if [ "$LINT_APPLICABLE" = true ]; then
  LINT_OUTPUT=$(npx biome check "$REL_PATH" 2>&1)
  LINT_EXIT=$?
fi

# --- Run TypeScript type check ---
if [ "$TYPE_APPLICABLE" = true ]; then
  # Determine tsconfig based on file location
  if [[ "$REL_PATH" == web/* ]]; then
    TYPE_OUTPUT=$(npx tsc --noEmit -p web/tsconfig.json 2>&1)
    TYPE_EXIT=$?
  else
    # src/*, tools/*, tests/*, root files
    TYPE_OUTPUT=$(npx tsc --noEmit 2>&1)
    TYPE_EXIT=$?
  fi
fi

# --- Output only if there are errors ---
if [ $LINT_EXIT -ne 0 ]; then
  echo "=== Biome Check: $REL_PATH ==="
  echo "$LINT_OUTPUT"
  echo ""
fi

if [ $TYPE_EXIT -ne 0 ]; then
  echo "=== TypeScript Check: $REL_PATH ==="
  echo "$TYPE_OUTPUT"
  echo ""
fi

# --- Determine final exit code ---
if [ $LINT_EXIT -ne 0 ] && [ $TYPE_EXIT -ne 0 ]; then
  exit 3
elif [ $LINT_EXIT -ne 0 ]; then
  exit 1
elif [ $TYPE_EXIT -ne 0 ]; then
  exit 2
else
  exit 0
fi
