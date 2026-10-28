import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_TEST_TIMEOUT_MS = PROBE_TIMEOUT_MS + 5_000;

// Runs in a fresh process: Sentry.init installs process-global OpenTelemetry state,
// and unit-core shares module state across files (isolate: false).
const SENTRY_SPAN_PROBE = `
import * as Sentry from '@sentry/node';
Sentry.init({
	dsn: 'https://public@example.invalid/1',
	tracesSampleRate: 1,
	transport: () => ({ send: async () => ({}), flush: async () => true }),
});
const recording = Sentry.startSpan({ name: 'cascade-tracing-probe' }, (span) => span.isRecording());
process.stdout.write(String(recording));
`;

describe('Sentry tracing dependency tree', () => {
	it(
		'starts a recording span through the real Sentry SDK',
		async () => {
			const { stdout } = await promisify(execFile)(
				process.execPath,
				['--input-type=module', '-e', SENTRY_SPAN_PROBE],
				{ cwd: ROOT, timeout: PROBE_TIMEOUT_MS },
			);

			expect(stdout).toBe('true');
		},
		PROBE_TEST_TIMEOUT_MS,
	);
});
