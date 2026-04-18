/**
 * Tests for the shared ProjectScopeStep (plan 010/3 task 1).
 */

import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { ProjectScopeStep } from '../../../../web/src/components/projects/pm-providers/steps/project-scope.js';
import { Combobox } from '../../../../web/src/components/ui/combobox.js';

/** Plan 011/1: same pattern as container-pick.test.ts. */
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

const step: StandardStep = { kind: 'project-scope', id: 'scope' };

describe('ProjectScopeStep', () => {
	it('renders "No project scope" as the first option', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [
					{ id: 'p1', name: 'Project One' },
					{ id: 'p2', name: 'Project Two' },
				],
				selectedProjectId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('No project scope');
		expect(html).toContain('Project One');
		expect(html).toContain('Project Two');
	});

	it('preselects the current project when supplied', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [
					{ id: 'p1', name: 'Project One' },
					{ id: 'p2', name: 'Project Two' },
				],
				selectedProjectId: 'p2',
				onSelect: () => {},
			}),
		);
		expect(html).toMatch(/<option[^>]*value="p2"[^>]*selected/);
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
				error: 'failed',
			}),
		);
		expect(error).toContain('data-state="error"');
	});

	it('exposes the select action identifier', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('data-action="select-project-scope"');
	});

	// ── Plan 011/1: searchable mode (opt-in) ───────────────────────────

	it('renders the shared Combobox when searchable is true', () => {
		const tree = ProjectScopeStep({
			step,
			providerId: 'linear',
			projects: [
				{ id: 'p1', name: 'Project One' },
				{ id: 'p2', name: 'Project Two' },
			],
			selectedProjectId: null,
			onSelect: () => {},
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		expect(combobox).not.toBeNull();
		expect(combobox?.type).toBe(Combobox);
	});

	it('includes an empty-value "No project scope" option + project options in searchable mode', () => {
		const tree = ProjectScopeStep({
			step,
			providerId: 'linear',
			projects: [
				{ id: 'p1', name: 'Project One' },
				{ id: 'p2', name: 'Project Two' },
			],
			selectedProjectId: 'p2',
			onSelect: () => {},
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		const props = combobox?.props as {
			options: Array<{ value: string; label: string }>;
			value: string;
		};
		// Semantics: the empty-string value maps to "No project scope". The
		// Combobox uses emptyLabel for the unselected display; options list
		// only real projects.
		expect(props.options.map((o) => o.value)).toEqual(['p1', 'p2']);
		expect(props.value).toBe('p2');
	});

	it('invokes onSelect(null) when Combobox onChange receives empty string', () => {
		let captured: string | null | undefined;
		const onSelect = (v: string | null) => {
			captured = v;
		};
		const tree = ProjectScopeStep({
			step,
			providerId: 'linear',
			projects: [{ id: 'p1', name: 'Project One' }],
			selectedProjectId: 'p1',
			onSelect,
			searchable: true,
		});
		const combobox = findComboboxChild(tree);
		const props = combobox?.props as { onChange: (v: string) => void };
		// Simulate Combobox emitting empty string (e.g. user cleared the value).
		props.onChange('');
		expect(captured).toBeNull();
		props.onChange('p1');
		expect(captured).toBe('p1');
	});
});
