/**
 * Tests for the shared ContainerPickStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { ContainerPickStep } from '../../../../web/src/components/projects/pm-providers/steps/container-pick.js';

const step: StandardStep = { kind: 'container-pick', id: 'pick' };

describe('ContainerPickStep', () => {
	it('renders one option per container', () => {
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				label: 'Select Board',
				options: [
					{ id: 'b1', name: 'Board One' },
					{ id: 'b2', name: 'Board Two' },
				],
				selectedId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('Board One');
		expect(html).toContain('Board Two');
		expect(html).toContain('data-action="select-container"');
	});

	it('shows the label heading when supplied', () => {
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				label: 'Select Board',
				options: [],
				selectedId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('Select Board');
	});

	it('renders loading state', () => {
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				options: [],
				selectedId: null,
				onSelect: () => {},
				loading: true,
			}),
		);
		expect(html).toContain('data-state="loading"');
	});

	it('renders error state', () => {
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				options: [],
				selectedId: null,
				onSelect: () => {},
				error: 'failed to fetch',
			}),
		);
		expect(html).toContain('data-state="error"');
		expect(html).toContain('failed to fetch');
	});

	it('preselects the current value', () => {
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				options: [
					{ id: 'b1', name: 'Board One' },
					{ id: 'b2', name: 'Board Two' },
				],
				selectedId: 'b2',
				onSelect: () => {},
			}),
		);
		// React SSR marks the selected option with `selected=""` attribute.
		expect(html).toMatch(/<option[^>]*value="b2"[^>]*selected/);
	});
});
