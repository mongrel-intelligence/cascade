import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RunPendingState } from '../../../web/src/components/runs/run-pending-state.js';

/**
 * Tests for the shared RunPendingState placeholder (MNG-1679).
 *
 * The web test suite runs in a node environment with no jsdom, so the component
 * is rendered to a static HTML string via `react-dom/server` and the output is
 * asserted — mirroring the style of tests/unit/web/trello-webhook-step.test.ts.
 */

describe('RunPendingState', () => {
	it('renders the "Run is starting…" heading', () => {
		const html = renderToStaticMarkup(createElement(RunPendingState, {}));
		expect(html).toContain('Run is starting');
	});

	it('renders an animate-spin spinner', () => {
		const html = renderToStaticMarkup(createElement(RunPendingState, {}));
		expect(html).toContain('animate-spin');
	});

	it('uses the shared py-8 text-center text-muted-foreground container styling', () => {
		const html = renderToStaticMarkup(createElement(RunPendingState, {}));
		expect(html).toContain('py-8 text-center text-muted-foreground');
	});

	it('renders the default subtext when no message prop is provided', () => {
		const html = renderToStaticMarkup(createElement(RunPendingState, {}));
		expect(html).toContain('update automatically');
	});

	it('renders a custom message when the message prop is provided', () => {
		const html = renderToStaticMarkup(
			createElement(RunPendingState, { message: 'Waiting for the worker to boot' }),
		);
		expect(html).toContain('Waiting for the worker to boot');
		// The default subtext is replaced, not appended.
		expect(html).not.toContain('update automatically');
	});
});
