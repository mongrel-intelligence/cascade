/**
 * CLI bootstrap — invoked from `bin/cascade-tools.js` before oclif loads
 * any command, so that PM/SCM/alerting providers are registered before
 * any command's `.run()` calls `createPMProvider`.
 *
 * Mirrors `src/router/index.ts:8` and `src/worker-entry.ts:19`. Spec 006/5
 * removed the legacy self-bootstrap path; every entry point now needs to
 * import these side-effect modules explicitly.
 *
 * Routed through the entry script (not `cli/base.ts`) so test files that
 * transitively import `cli/base.ts` don't trigger manifest evaluation
 * during integration test discovery — see PR thread for the cycle that
 * caused.
 */
import '../integrations/pm/index.js';
import '../github/register.js';
import '../sentry/register.js';
