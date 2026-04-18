/**
 * Lifecycle scenario against the in-memory FakePMProvider.
 *
 * Plan 009/1 task 6 introduces a full-lifecycle fake that implements every
 * method on the PMProvider contract with an in-memory store. This test is
 * the ground-truth exerciser: it runs the shared `runLifecycleScenario`
 * helper against the fake and asserts each step's observable effect.
 *
 * The same helper runs against real providers (Trello/JIRA/Linear) once
 * they opt into `manifest.lifecycle.enabled = true` in plans 2, 3, 4.
 */

import { describe, expect, it } from 'vitest';
import {
	createFakePMManifest,
	createFakePMProvider,
	runLifecycleScenario,
} from '../../helpers/fakePMProvider.js';

describe('FakePMProvider — lifecycle', () => {
	it('createFakePMProvider returns a typed PMProvider wired to an in-memory store', () => {
		const { provider, store } = createFakePMProvider();
		expect(provider.type).toBe('trello'); // fake declares itself as a PMType — see fixture doc
		expect(store.workItems.size).toBe(0);
		expect(store.containers.size).toBeGreaterThan(0);
	});

	it('createFakePMManifest declares configSchema, discoveryCapabilities, wizardSpec, and lifecycle', () => {
		const m = createFakePMManifest();
		expect(m.configSchema).toBeDefined();
		expect(m.discoveryCapabilities?.teams).toBe(true);
		expect(m.discoveryCapabilities?.labels).toBe(true);
		expect(m.discoveryCapabilities?.states).toBe(true);
		expect(m.wizardSpec?.steps.length).toBeGreaterThan(0);
		expect(m.lifecycle?.enabled).toBe(true);
	});

	it('runLifecycleScenario exercises create → list → move → checklist → comment → delete', async () => {
		const { provider, store } = createFakePMProvider();
		const containerId = Array.from(store.containers.keys())[0];
		if (!containerId) throw new Error('fake provider initialised without containers');

		const report = await runLifecycleScenario(provider, containerId, {
			title: 'Test item',
			description: 'Hello world',
		});

		// Every step must complete. Any failure throws — presence of the
		// report object is already a success, but we validate the shape for
		// future regressions.
		expect(report.created.id).toBeTruthy();
		expect(report.created.title).toBe('Test item');
		expect(report.listed.length).toBeGreaterThan(0);
		expect(report.listed.some((i) => i.id === report.created.id)).toBe(true);
		expect(report.moved).toBe(true);
		expect(report.checklistId).toBeTruthy();
		expect(report.checklistItemsAfterToggle).toEqual(
			expect.arrayContaining([expect.objectContaining({ complete: true })]),
		);
		expect(report.commentId).toBeTruthy();
		expect(report.deleted).toBe(true);

		// The in-memory store should reflect delete — the work item is gone.
		expect(store.workItems.has(report.created.id)).toBe(false);
	});

	it('discover("states") returns a typed states array with category values', async () => {
		const { provider } = createFakePMProvider();
		const result = await provider.discover?.('states', { containerId: 'any' as never });
		expect(Array.isArray(result)).toBe(true);
		expect((result ?? []).length).toBeGreaterThan(0);
		for (const state of result ?? []) {
			expect(state.id).toBeTruthy();
			expect(state.name).toBeTruthy();
			expect(['todo', 'in_progress', 'done', 'canceled', 'unknown']).toContain(state.category);
		}
	});

	it('discover("labels") returns a typed labels array', async () => {
		const { provider } = createFakePMProvider();
		const result = await provider.discover?.('labels', { containerId: 'any' as never });
		expect(Array.isArray(result)).toBe(true);
		expect((result ?? []).length).toBeGreaterThan(0);
		for (const label of result ?? []) {
			expect(label.id).toBeTruthy();
			expect(label.name).toBeTruthy();
		}
	});

	it('discover("teams") returns a typed teams array (containers)', async () => {
		const { provider } = createFakePMProvider();
		const result = await provider.discover?.('teams', {});
		expect(Array.isArray(result)).toBe(true);
		expect((result ?? []).length).toBeGreaterThan(0);
	});

	it('createLabel hook (plan 010/1) returns { id, name, color }', async () => {
		const m = createFakePMManifest();
		const result = await m.createLabel?.({
			credentials: {},
			containerId: 'fake-container-a',
			name: 'bug',
			color: 'red',
		});
		expect(result).toMatchObject({ name: 'bug', color: 'red' });
		expect(result?.id).toBeTruthy();
	});

	it('createLabel hook defaults color when omitted', async () => {
		const m = createFakePMManifest();
		const result = await m.createLabel?.({
			credentials: {},
			containerId: 'fake-container-a',
			name: 'feature',
		});
		expect(result?.color).toBe('gray');
	});

	it('createCustomField hook (plan 010/1) returns { id, name, type }', async () => {
		const m = createFakePMManifest();
		const result = await m.createCustomField?.({
			credentials: {},
			containerId: 'fake-container-a',
			name: 'Cost',
		});
		expect(result).toMatchObject({ name: 'Cost', type: 'text' });
		expect(result?.id).toBeTruthy();
	});

	it('configSchema round-trip identity (save → load → save → deep-equal)', () => {
		const m = createFakePMManifest();
		const schema = m.configSchema;
		if (!schema) throw new Error('fake manifest must declare configSchema');
		const fixture = m.configFixture;
		const parsed1 = schema.parse(fixture);
		const parsed2 = schema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});
});
