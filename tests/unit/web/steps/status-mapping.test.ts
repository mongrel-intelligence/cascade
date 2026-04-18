/**
 * Tests for the shared StatusMappingStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { StatusMappingStep } from '../../../../web/src/components/projects/pm-providers/steps/status-mapping.js';

const step: StandardStep = { kind: 'status-mapping', id: 'status' };

const cascadeStatuses = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'todo', label: 'To Do' },
	{ key: 'done', label: 'Done' },
];

const providerStates = [
	{ id: 'state-todo', name: 'To Do', category: 'todo' as const },
	{ id: 'state-done', name: 'Done', category: 'done' as const },
];

describe('StatusMappingStep', () => {
	it('renders one row per CASCADE status', () => {
		const html = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses,
				providerStates,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-cascade-status="backlog"');
		expect(html).toContain('data-cascade-status="todo"');
		expect(html).toContain('data-cascade-status="done"');
	});

	it('each row lists every provider state as an option', () => {
		const html = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses,
				providerStates,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		// Provider state "To Do" appears once per row as an <option> — 3 rows → 3 option tags.
		const toDoOptions = html.match(/<option[^>]*value="state-todo"/g) ?? [];
		expect(toDoOptions.length).toBe(3);
	});

	it('reflects the current mapping in the selected option', () => {
		const html = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses,
				providerStates,
				mappings: { done: 'state-done' },
				onMappingChange: () => {},
			}),
		);
		// done-row's state-done option is preselected.
		expect(html).toMatch(/id="status-done"[^>]*/);
		expect(html).toMatch(/<option[^>]*value="state-done"[^>]*selected/);
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses,
				providerStates: [],
				mappings: {},
				onMappingChange: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses,
				providerStates: [],
				mappings: {},
				onMappingChange: () => {},
				error: 'failed',
			}),
		);
		expect(error).toContain('data-state="error"');
		expect(error).toContain('failed');
	});

	it('exposes the state category via data-category', () => {
		const html = renderToStaticMarkup(
			createElement(StatusMappingStep, {
				step,
				providerId: 'linear',
				cascadeStatuses: [{ key: 'todo', label: 'To Do' }],
				providerStates,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-category="todo"');
		expect(html).toContain('data-category="done"');
	});
});
