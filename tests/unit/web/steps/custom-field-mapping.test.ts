/**
 * Tests for the shared CustomFieldMappingStep (plan 011/1 task 4).
 *
 * The 7th StandardStepKind. Renders one row per CASCADE custom-field slot
 * with a dropdown of discovered provider custom fields + an optional
 * inline "Create…" affordance wired to `manifest.createCustomField` via
 * `pm.discovery.createCustomField` (spec 010/1).
 */

import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { CustomFieldMappingStep } from '../../../../web/src/components/projects/pm-providers/steps/custom-field-mapping.js';

/** Flatten the rendered element tree into a list of React elements. */
function flatten(node: unknown, out: ReactElement[]): void {
	if (!isValidElement(node)) return;
	out.push(node);
	const children = (node.props as { children?: unknown }).children;
	if (Array.isArray(children)) {
		for (const c of children) flatten(c, out);
	} else {
		flatten(children, out);
	}
}

const step: StandardStep = { kind: 'custom-field-mapping', id: 'cf' };

const cascadeSlots = [
	{ key: 'cost', label: 'Cost Estimate' },
	{ key: 'effort', label: 'Effort Estimate' },
];

const providerCustomFields = [
	{ id: 'fld-1', name: 'Cost', type: 'number' },
	{ id: 'fld-2', name: 'Effort', type: 'number' },
];

describe('CustomFieldMappingStep', () => {
	it('renders one row per CASCADE slot', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-cascade-slot="cost"');
		expect(html).toContain('data-cascade-slot="effort"');
	});

	it('each row lists every provider custom field as an option', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		// 2 rows × 2 provider custom fields = 4 matching <option> tags.
		const fld1Options = html.match(/<option[^>]*value="fld-1"/g) ?? [];
		expect(fld1Options.length).toBe(2);
	});

	it('reflects the current mapping in the selected option', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields,
				mappings: { cost: 'fld-1' },
				onMappingChange: () => {},
			}),
		);
		expect(html).toMatch(/<option[^>]*value="fld-1"[^>]*selected/);
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields: [],
				mappings: {},
				onMappingChange: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields: [],
				mappings: {},
				onMappingChange: () => {},
				error: 'failed to fetch',
			}),
		);
		expect(error).toContain('data-state="error"');
		expect(error).toContain('failed to fetch');
	});

	it('invokes onMappingChange(slotKey, fieldId) when a dropdown value changes', () => {
		const onMappingChange = vi.fn();
		const tree = CustomFieldMappingStep({
			step,
			providerId: 'trello',
			cascadeSlots,
			providerCustomFields,
			mappings: {},
			onMappingChange,
		});
		const elements: ReactElement[] = [];
		flatten(tree, elements);
		const selects = elements.filter((el) => el.type === 'select');
		expect(selects.length).toBe(2);
		const costSelect = selects.find(
			(el) => (el.props as { id?: string }).id === 'custom-field-cost',
		);
		expect(costSelect).toBeDefined();
		const onChange = (costSelect?.props as { onChange?: (e: unknown) => void }).onChange;
		expect(onChange).toBeTypeOf('function');
		onChange?.({ target: { value: 'fld-2' } });
		expect(onMappingChange).toHaveBeenCalledWith('cost', 'fld-2');
	});

	it('exposes an inline Create affordance when onCreateCustomField is supplied', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'jira',
				cascadeSlots: [{ key: 'cost', label: 'Cost' }],
				providerCustomFields: [],
				mappings: {},
				onMappingChange: () => {},
				onCreateCustomField: () => {},
			}),
		);
		expect(html).toContain('data-action="create-custom-field"');
	});

	it('hides the Create affordance when onCreateCustomField is omitted', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'jira',
				cascadeSlots: [{ key: 'cost', label: 'Cost' }],
				providerCustomFields: [],
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).not.toContain('data-action="create-custom-field"');
	});

	it('exposes the step component identifier + step id', () => {
		const html = renderToStaticMarkup(
			createElement(CustomFieldMappingStep, {
				step,
				providerId: 'trello',
				cascadeSlots,
				providerCustomFields,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-step-component="custom-field-mapping"');
		expect(html).toContain('data-step-id="cf"');
	});
});
