import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkItemRunsTable } from '../../../web/src/components/runs/work-item-runs-table.js';

/**
 * Tests for the WorkItemRunsTable empty-branch pending state (MNG-1680).
 *
 * Work-item / PR runs links are posted at ack time — before the worker commits
 * the run row — so an empty list within the grace window means "the run is
 * starting", not "no runs". When `isPending` is true the empty branch renders
 * the shared "Run is starting…" placeholder instead of the terminal
 * "No runs found" copy.
 *
 * The web test suite runs in a node environment with no jsdom, so the component
 * is rendered to a static HTML string via `react-dom/server` and the output is
 * asserted — mirroring the style of tests/unit/web/run-pending-state.test.ts.
 * Only the non-table branches (loading / error / empty) are rendered; the table
 * rows pull in `@tanstack/react-router`'s `Link`, which needs a router context.
 */

const EMPTY = { runs: [], isLoading: false, isError: false } as const;

describe('WorkItemRunsTable — empty branch', () => {
	it('renders the "Run is starting…" pending state when isPending is true', () => {
		const html = renderToStaticMarkup(
			createElement(WorkItemRunsTable, { ...EMPTY, isPending: true }),
		);
		expect(html).toContain('Run is starting');
		expect(html).toContain('animate-spin');
		// The work-item-tailored subtext is shown (apostrophe is HTML-escaped, so
		// assert on a substring without it).
		expect(html).toContain('will appear here automatically once the worker starts');
		// The terminal copy must not leak through while pending.
		expect(html).not.toContain('No runs found');
	});

	it('renders "No runs found" when isPending is false', () => {
		const html = renderToStaticMarkup(
			createElement(WorkItemRunsTable, { ...EMPTY, isPending: false }),
		);
		expect(html).toContain('No runs found');
		expect(html).not.toContain('Run is starting');
	});

	it('defaults to "No runs found" when isPending is omitted (PR runs page path)', () => {
		// The PR runs page reuses this table without passing isPending, so the
		// historical terminal copy must remain the default.
		const html = renderToStaticMarkup(createElement(WorkItemRunsTable, EMPTY));
		expect(html).toContain('No runs found');
		expect(html).not.toContain('Run is starting');
	});
});

describe('WorkItemRunsTable — loading / error take precedence over pending', () => {
	it('shows the loading copy even when isPending is true', () => {
		const html = renderToStaticMarkup(
			createElement(WorkItemRunsTable, {
				runs: undefined,
				isLoading: true,
				isError: false,
				isPending: true,
			}),
		);
		expect(html).toContain('Loading runs');
		expect(html).not.toContain('Run is starting');
		expect(html).not.toContain('No runs found');
	});

	it('shows the error copy even when isPending is true', () => {
		const html = renderToStaticMarkup(
			createElement(WorkItemRunsTable, {
				runs: undefined,
				isLoading: false,
				isError: true,
				error: { message: 'boom' },
				isPending: true,
			}),
		);
		expect(html).toContain('Failed to load runs');
		expect(html).toContain('boom');
		expect(html).not.toContain('Run is starting');
	});
});
