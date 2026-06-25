import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the Debug Analysis panel persistent in-progress UX (MNG-1668).
 *
 * Two layers are covered:
 *   1. The pure decision helpers in `web/src/lib/debug-analysis.ts`
 *      (`computeDebugAnalysisRunning` + `debugAnalysisRefetchInterval`) — these
 *      encode the "don't flicker the button back" logic and are node-testable.
 *   2. The presentational `DebugAnalysisView` rendered to a static HTML string
 *      via `react-dom/server` (the web suite runs in a node environment with no
 *      jsdom — mirrors tests/unit/web/run-pending-state.test.ts).
 *
 * The component module imports `@/lib/trpc.js`, which builds a real tRPC client
 * at module load. `DebugAnalysisView` never touches it, so stub the module to
 * keep the render hermetic — mirrors the `@/lib/trpc.js` stub in
 * tests/unit/web/stats-page.test.ts. `react-markdown` is left real: it resolves
 * transitively from web/node_modules (like `lucide-react` does for
 * run-pending-state.test.ts) and renders the section text we assert on.
 */

vi.mock('@/lib/trpc.js', () => ({
	trpc: {
		runs: {
			getDebugAnalysis: { queryOptions: () => ({ queryKey: [] }) },
			getDebugAnalysisStatus: { queryOptions: () => ({ queryKey: [] }) },
		},
	},
	trpcClient: { runs: { triggerDebugAnalysis: { mutate: () => Promise.resolve() } } },
}));

import {
	type DebugAnalysisContent,
	DebugAnalysisRunningIndicator,
	DebugAnalysisView,
	type DebugAnalysisViewProps,
} from '../../../web/src/components/debug/debug-analysis.js';
import {
	computeDebugAnalysisRunning,
	DEBUG_ANALYSIS_POLL_MS,
	type DebugAnalysisStatus,
	debugAnalysisRefetchInterval,
	isTerminalDebugAnalysisStatus,
} from '../../../web/src/lib/debug-analysis.js';

const ALL_STATUSES: (DebugAnalysisStatus | undefined)[] = [
	undefined,
	'idle',
	'running',
	'completed',
	'failed',
];

/** Render the presentational view with sensible defaults overridden per test. */
function renderView(overrides: Partial<DebugAnalysisViewProps> = {}): string {
	const props: DebugAnalysisViewProps = {
		status: 'idle',
		isRunning: false,
		analysis: null,
		isTriggerError: false,
		triggerError: null,
		onTrigger: () => {},
		...overrides,
	};
	return renderToStaticMarkup(createElement(DebugAnalysisView, props));
}

/**
 * A native `disabled` boolean attribute serializes as `disabled=""`. The button
 * className always contains `disabled:opacity-50`, so this exact token (with the
 * `="`) is what distinguishes a truly-disabled button from the class utility.
 */
function hasDisabledButton(html: string): boolean {
	return html.includes('disabled=""');
}

// ─── DEBUG_ANALYSIS_POLL_MS ──────────────────────────────────────────────────

describe('DEBUG_ANALYSIS_POLL_MS', () => {
	it('polls every 5000ms', () => {
		expect(DEBUG_ANALYSIS_POLL_MS).toBe(5000);
	});
});

// ─── isTerminalDebugAnalysisStatus ───────────────────────────────────────────

describe('isTerminalDebugAnalysisStatus', () => {
	it('is true for completed', () => {
		expect(isTerminalDebugAnalysisStatus('completed')).toBe(true);
	});

	it('is true for failed', () => {
		expect(isTerminalDebugAnalysisStatus('failed')).toBe(true);
	});

	it('is false for running', () => {
		expect(isTerminalDebugAnalysisStatus('running')).toBe(false);
	});

	it('is false for idle', () => {
		expect(isTerminalDebugAnalysisStatus('idle')).toBe(false);
	});

	it('is false for undefined', () => {
		expect(isTerminalDebugAnalysisStatus(undefined)).toBe(false);
	});
});

// ─── computeDebugAnalysisRunning (AC #2) ─────────────────────────────────────

describe('computeDebugAnalysisRunning', () => {
	const base = {
		triggerIsPending: false,
		triggerIsSuccess: false,
		status: undefined as DebugAnalysisStatus | undefined,
	};

	it('is true while the trigger mutation is in flight', () => {
		expect(computeDebugAnalysisRunning({ ...base, triggerIsPending: true })).toBe(true);
	});

	it('is true right after trigger success while status is still undefined (queued gap)', () => {
		expect(computeDebugAnalysisRunning({ ...base, triggerIsSuccess: true })).toBe(true);
	});

	it('is true right after trigger success while status still reads idle', () => {
		expect(computeDebugAnalysisRunning({ ...base, triggerIsSuccess: true, status: 'idle' })).toBe(
			true,
		);
	});

	it('is true while status is running even after the mutation has settled', () => {
		expect(computeDebugAnalysisRunning({ ...base, status: 'running' })).toBe(true);
	});

	it('is false once status is completed (even with a lingering isSuccess)', () => {
		expect(
			computeDebugAnalysisRunning({ ...base, triggerIsSuccess: true, status: 'completed' }),
		).toBe(false);
	});

	it('is false once status is failed so the button re-enables for retry', () => {
		expect(computeDebugAnalysisRunning({ ...base, triggerIsSuccess: true, status: 'failed' })).toBe(
			false,
		);
	});

	it('is false when idle and nothing is pending or just-succeeded', () => {
		expect(computeDebugAnalysisRunning({ ...base, status: 'idle' })).toBe(false);
	});

	it('is false when status is undefined and nothing is pending or just-succeeded', () => {
		expect(computeDebugAnalysisRunning(base)).toBe(false);
	});

	it('matches the acceptance-criteria expression for every input combination', () => {
		for (const triggerIsPending of [true, false]) {
			for (const triggerIsSuccess of [true, false]) {
				for (const status of ALL_STATUSES) {
					const expected =
						triggerIsPending ||
						(triggerIsSuccess && status !== 'completed' && status !== 'failed') ||
						status === 'running';
					expect(computeDebugAnalysisRunning({ triggerIsPending, triggerIsSuccess, status })).toBe(
						expected,
					);
				}
			}
		}
	});
});

// ─── debugAnalysisRefetchInterval (AC #1) ────────────────────────────────────

describe('debugAnalysisRefetchInterval', () => {
	it('polls while status is running', () => {
		expect(debugAnalysisRefetchInterval({ status: 'running', pollingActive: false })).toBe(
			DEBUG_ANALYSIS_POLL_MS,
		);
	});

	it('polls while the polling-active flag is set even if status still reads idle', () => {
		expect(debugAnalysisRefetchInterval({ status: 'idle', pollingActive: true })).toBe(
			DEBUG_ANALYSIS_POLL_MS,
		);
	});

	it('polls while the polling-active flag is set and status is undefined (trigger gap)', () => {
		expect(debugAnalysisRefetchInterval({ status: undefined, pollingActive: true })).toBe(
			DEBUG_ANALYSIS_POLL_MS,
		);
	});

	it('stops once status is completed even if the polling-active flag has not cleared yet', () => {
		expect(debugAnalysisRefetchInterval({ status: 'completed', pollingActive: true })).toBe(false);
	});

	it('stops once status is failed even if the polling-active flag has not cleared yet', () => {
		expect(debugAnalysisRefetchInterval({ status: 'failed', pollingActive: true })).toBe(false);
	});

	it('does not poll when idle and the polling-active flag is unset', () => {
		expect(debugAnalysisRefetchInterval({ status: 'idle', pollingActive: false })).toBe(false);
	});

	it('does not poll when status is undefined and the polling-active flag is unset', () => {
		expect(debugAnalysisRefetchInterval({ status: undefined, pollingActive: false })).toBe(false);
	});
});

// ─── DebugAnalysisRunningIndicator ───────────────────────────────────────────

describe('DebugAnalysisRunningIndicator', () => {
	it('renders a spinner and the multi-minute in-progress copy', () => {
		const html = renderToStaticMarkup(createElement(DebugAnalysisRunningIndicator));
		expect(html).toContain('animate-spin');
		expect(html).toContain('Debug analysis is running');
		expect(html).toContain('this can take a few minutes');
	});
});

// ─── DebugAnalysisView — first run, no prior analysis (AC #3, #4, #5) ─────────

describe('DebugAnalysisView — first run (no prior analysis)', () => {
	it('after trigger: shows the in-progress affordance and disables the Run button', () => {
		const html = renderView({ status: 'idle', isRunning: true, analysis: null });
		expect(html).toContain('Debug analysis is running');
		expect(html).toContain('animate-spin');
		expect(html).toContain('Run Analysis');
		expect(hasDisabledButton(html)).toBe(true);
		// The idle "nothing here yet" copy is replaced by the affordance.
		expect(html).not.toContain('No debug analysis available');
	});

	it('stays in-progress (disabled) while the status reads running', () => {
		const html = renderView({ status: 'running', isRunning: true, analysis: null });
		expect(html).toContain('Debug analysis is running');
		expect(hasDisabledButton(html)).toBe(true);
	});

	it('failed: renders an error message and re-enables the Run button for retry', () => {
		const html = renderView({ status: 'failed', isRunning: false, analysis: null });
		expect(html).toContain('Debug analysis failed');
		expect(html).toContain('Run Analysis');
		expect(hasDisabledButton(html)).toBe(false);
		expect(html).not.toContain('Debug analysis is running');
	});

	it('idle with no analysis: shows the empty copy and an enabled Run button', () => {
		const html = renderView({ status: 'idle', isRunning: false, analysis: null });
		expect(html).toContain('No debug analysis available');
		expect(hasDisabledButton(html)).toBe(false);
		expect(html).not.toContain('Debug analysis is running');
	});

	it('preserves the synchronous trigger error message (CONFLICT / validation)', () => {
		const html = renderView({
			status: 'idle',
			isRunning: false,
			analysis: null,
			isTriggerError: true,
			triggerError: new Error('Debug analysis is already running for this run'),
		});
		expect(html).toContain('Debug analysis is already running for this run');
	});

	it('falls back to a generic trigger-error message for a non-Error rejection', () => {
		const html = renderView({
			status: 'idle',
			isRunning: false,
			analysis: null,
			isTriggerError: true,
			triggerError: 'boom',
		});
		expect(html).toContain('Failed to trigger analysis');
	});
});

// ─── DebugAnalysisView — existing analysis, re-run (AC #3, #4) ────────────────

describe('DebugAnalysisView — existing analysis (re-run)', () => {
	const analysis: DebugAnalysisContent = {
		severity: 'high',
		summary: 'Root cause summary text',
		issues: 'The issue list',
	};

	it('disables the Re-run button and shows the affordance while running', () => {
		const html = renderView({ status: 'running', isRunning: true, analysis });
		expect(html).toContain('Re-run Analysis');
		expect(hasDisabledButton(html)).toBe(true);
		expect(html).toContain('Debug analysis is running');
		// The prior analysis stays visible during a re-run.
		expect(html).toContain('Root cause summary text');
	});

	it('keeps the Re-run button enabled when the analysis is complete', () => {
		const html = renderView({ status: 'completed', isRunning: false, analysis });
		expect(html).toContain('Re-run Analysis');
		expect(hasDisabledButton(html)).toBe(false);
		expect(html).not.toContain('Debug analysis is running');
		expect(html).toContain('Root cause summary text');
	});

	it('failed re-run: shows the error and keeps the Re-run button enabled', () => {
		const html = renderView({ status: 'failed', isRunning: false, analysis });
		expect(html).toContain('Debug analysis failed');
		expect(hasDisabledButton(html)).toBe(false);
	});
});
