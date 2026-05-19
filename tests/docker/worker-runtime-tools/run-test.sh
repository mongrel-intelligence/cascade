#!/usr/bin/env bash
# Smoke-test the worker image's baseline native-session runtime tools.
#
# This is the single source of truth for "what does CASCADE guarantee is
# already installed in a worker shell" — CI (Dockerfile.worker build job) and
# the deploy pipelines (`.github/workflows/deploy{,-dev}.yml`) all invoke
# this same script. Failure here is intentionally noisy so that a missing
# Python shim, a missing Playwright Chromium browser, or a broken
# `PLAYWRIGHT_BROWSERS_PATH` blocks image promotion before the broken image
# reaches production agents.
#
# Usage:
#   WORKER_IMAGE=cascade-worker:ci-check tests/docker/worker-runtime-tools/run-test.sh
#
# See MNG-1055 and the friction clusters cited in the comment in
# Dockerfile.worker for the motivating bug pattern.
set -euo pipefail

WORKER_IMAGE="${WORKER_IMAGE:-cascade-worker:ci-check}"

echo "=== Worker Runtime Tools Smoke Test ==="
echo "Worker image : $WORKER_IMAGE"
echo ""

# 1. Python shim — `python` and `python3` both work, and the std-lib import
# path is healthy. Repeated friction reports (see Dockerfile.worker comment
# for the full cluster) traced to agents calling `python -c '...'` and
# hitting `command not found` on bare `python3`-only images.
docker run --rm "$WORKER_IMAGE" bash -lc '
  set -e
  echo "--- Python shim check ---"
  python3 --version
  python --version
  python -c "import json; print(json.dumps({\"ok\": True}))"
  echo ""
'

# 2. Playwright Chromium — the cache lives at $PLAYWRIGHT_BROWSERS_PATH and
# is readable/writable by the unprivileged `node` user the worker switches to.
# Write access is deliberate: project `.cascade/setup.sh` scripts inherit this
# env var, and repos pinned to a different Playwright revision must be able to
# install the missing browser revision into the shared cache. The native-tool
# env filter (src/backends/shared/envFilter.ts) allowlists this single exact
# variable; broader `PLAYWRIGHT_*` propagation is intentionally off to keep the
# defense-in-depth posture for the rest of Playwright's env surface.
#
# `NODE_PATH=$(npm root -g)` is the documented way to require globally
# installed packages from a one-off Node invocation — `@playwright/test`
# is installed globally in the worker image, not in any per-agent
# workspace.
docker run --rm "$WORKER_IMAGE" bash -lc '
  set -e
  echo "--- Playwright runtime context ---"
  echo "node:                       $(node --version)"
  echo "PLAYWRIGHT_BROWSERS_PATH:   ${PLAYWRIGHT_BROWSERS_PATH:-<UNSET>}"
  if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    echo "FAIL: PLAYWRIGHT_BROWSERS_PATH is not set in the worker image"
    exit 1
  fi
  if [ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]; then
    echo "FAIL: PLAYWRIGHT_BROWSERS_PATH ($PLAYWRIGHT_BROWSERS_PATH) does not exist"
    exit 1
  fi
  if [ ! -w "$PLAYWRIGHT_BROWSERS_PATH" ]; then
    echo "FAIL: PLAYWRIGHT_BROWSERS_PATH ($PLAYWRIGHT_BROWSERS_PATH) is not writable by $(id -un)"
    exit 1
  fi
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/.cascade-write-test"
  rmdir "$PLAYWRIGHT_BROWSERS_PATH/.cascade-write-test"
  NODE_PATH=$(npm root -g) node -e "console.log(\"playwright version:        \" + require(\"@playwright/test/package.json\").version)"
  echo ""

  echo "--- Playwright Chromium launch check ---"
  NODE_PATH=$(npm root -g) node -e "
    const { chromium } = require(\"@playwright/test\");
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(\"<html><body><p id=cascade>cascade-worker-ok</p></body></html>\");
      const text = await page.textContent(\"#cascade\");
      if (text !== \"cascade-worker-ok\") {
        throw new Error(\"Unexpected DOM text: \" + text);
      }
      await browser.close();
      console.log(\"Playwright Chromium launch OK\");
    })().catch((err) => {
      console.error(\"FAIL: Playwright Chromium launch failed\");
      console.error(err && err.stack ? err.stack : err);
      process.exit(1);
    });
  "
'

echo ""
echo "=== Worker runtime tools smoke test PASSED ==="
