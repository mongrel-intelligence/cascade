/**
 * Tests for the shared LabelMappingStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { LabelMappingStep } from '../../../../web/src/components/projects/pm-providers/steps/label-mapping.js';

const step: StandardStep = { kind: 'label-mapping', id: 'labels' };

const labelSlots = [
	{ key: 'processing', label: 'Processing' },
	{ key: 'error', label: 'Error' },
];

const providerLabels = [
	{ id: 'lbl-processing', name: 'cascade-processing', color: 'blue' },
	{ id: 'lbl-error', name: 'cascade-error', color: 'red' },
];

describe('LabelMappingStep', () => {
	it('renders dropdowns when providerLabels is populated (enum mode)', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-mode="enum"');
		expect(html).toContain('cascade-processing');
		expect(html).toContain('cascade-error');
	});

	it('renders text inputs when providerLabels is empty (free-text mode, e.g. JIRA)', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'jira',
				labelSlots,
				providerLabels: [],
				mappings: { processing: 'cascade-processing' },
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-mode="free-text"');
		expect(html).toContain('placeholder="Label name"');
		expect(html).toMatch(/id="label-processing"[^>]*value="cascade-processing"/);
	});

	it('shows "Create label" button when onCreateLabel is supplied', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
				onCreateLabel: () => {},
			}),
		);
		expect(html).toContain('data-action="create-label"');
	});

	it('hides "Create label" button when onCreateLabel is not supplied', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'linear',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).not.toContain('data-action="create-label"');
	});

	it('renders label row with color metadata', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-color="blue"');
		expect(html).toContain('data-color="red"');
	});

	// ── Plan 011/1 (forward-edit for 011/2): labelDefaults pre-populates Create input ──

	it('pre-populates the Create input with labelDefaults[slotKey].name when supplied', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
				onCreateLabel: () => {},
				labelDefaults: {
					processing: { name: 'cascade-processing', color: 'blue' },
					error: { name: 'cascade-error', color: 'red' },
				},
			}),
		);
		// Each Create row's text input starts with the default name.
		expect(html).toMatch(/placeholder="New label name"[^>]*value="cascade-processing"/);
		expect(html).toMatch(/placeholder="New label name"[^>]*value="cascade-error"/);
	});

	it('exposes the labelDefaults color on the Create button via data-create-color', () => {
		// The onClick handler reads color from labelDefaults; we pin the wire-
		// through via a data attribute (SSR-observable) rather than RTL.
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels,
				mappings: {},
				onMappingChange: () => {},
				onCreateLabel: () => {},
				labelDefaults: {
					processing: { name: 'cascade-processing', color: 'sky' },
					error: { name: 'cascade-error', color: 'red' },
				},
			}),
		);
		expect(html).toContain('data-create-color="sky"');
		expect(html).toContain('data-create-color="red"');
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels: [],
				mappings: {},
				onMappingChange: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels: [],
				mappings: {},
				onMappingChange: () => {},
				error: 'failed',
			}),
		);
		expect(error).toContain('data-state="error"');
	});
});
