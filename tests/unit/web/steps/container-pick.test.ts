/**
 * Tests for the shared ContainerPickStep (plan 010/3 task 1).
 */

import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { ContainerPickStep } from '../../../../web/src/components/projects/pm-providers/steps/container-pick.js';
import { Combobox } from '../../../../web/src/components/ui/combobox.js';

/**
 * Helper for searchable-mode tests. We can't SSR-render through the shared
 * Combobox (radix-ui lives in web/node_modules and pulls its own React
 * instance — instance mismatch breaks useMemo / context). Instead we assert
 * the element tree shape: find the Combobox child and check its props.
 */
function findComboboxChild(element: ReactElement): ReactElement | null {
	const children = (element.props as { children?: unknown }).children;
	if (Array.isArray(children)) {
		for (const child of children) {
			if (isValidElement(child) && child.type === Combobox) return child;
		}
	} else if (isValidElement(children) && children.type === Combobox) {
		return children;
	}
	return null;
}

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

	// ── Plan 011/1: searchable mode (opt-in) ───────────────────────────

	it('renders the shared Combobox (not a plain <select>) when searchable is true', () => {
		const tree = ContainerPickStep({
			step,
			providerId: 'trello',
			options: [
				{ id: 'b1', name: 'Board One' },
				{ id: 'b2', name: 'Board Two' },
			],
			selectedId: null,
			onSelect: () => {},
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		expect(combobox).not.toBeNull();
		expect(combobox?.type).toBe(Combobox);
	});

	it('maps options to ComboboxOption[] with detail from url in searchable mode', () => {
		const tree = ContainerPickStep({
			step,
			providerId: 'trello',
			options: [
				{ id: 'b1', name: 'Board One', url: 'https://trello.com/b/b1' },
				{ id: 'b2', name: 'Board Two' },
			],
			selectedId: 'b2',
			onSelect: () => {},
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		expect(combobox).not.toBeNull();
		const props = combobox?.props as {
			options: Array<{ value: string; label: string; detail?: string }>;
			value: string;
		};
		expect(props.options).toEqual([
			{ value: 'b1', label: 'Board One', detail: 'https://trello.com/b/b1' },
			{ value: 'b2', label: 'Board Two', detail: undefined },
		]);
		expect(props.value).toBe('b2');
	});

	it('wires onSelect directly as the Combobox onChange handler', () => {
		const onSelect = (_id: string) => {};
		const tree = ContainerPickStep({
			step,
			providerId: 'trello',
			options: [{ id: 'b1', name: 'Board One' }],
			selectedId: null,
			onSelect,
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		const props = combobox?.props as { onChange: (v: string) => void };
		expect(props.onChange).toBe(onSelect);
	});

	it('still shows loading state in searchable mode', () => {
		// Loading short-circuits before Combobox — no React instance issue here.
		const html = renderToStaticMarkup(
			createElement(ContainerPickStep, {
				step,
				providerId: 'trello',
				options: [],
				selectedId: null,
				onSelect: () => {},
				loading: true,
				searchable: true,
			}),
		);
		expect(html).toContain('data-state="loading"');
	});
});
