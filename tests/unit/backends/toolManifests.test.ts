import { describe, expect, it } from 'vitest';
import { getToolManifests } from '../../../src/agents/definitions/toolManifests.js';

describe('getToolManifests', () => {
	it('returns an array of tool manifests', () => {
		const manifests = getToolManifests();
		expect(Array.isArray(manifests)).toBe(true);
		expect(manifests.length).toBeGreaterThan(0);
	});

	it('returns exactly 21 tools', () => {
		const manifests = getToolManifests();
		expect(manifests).toHaveLength(21);
	});

	it('every manifest has required fields: name, description, cliCommand, parameters', () => {
		const manifests = getToolManifests();
		for (const manifest of manifests) {
			expect(typeof manifest.name).toBe('string');
			expect(manifest.name.length).toBeGreaterThan(0);
			expect(typeof manifest.description).toBe('string');
			expect(manifest.description.length).toBeGreaterThan(0);
			expect(typeof manifest.cliCommand).toBe('string');
			expect(manifest.cliCommand.length).toBeGreaterThan(0);
			expect(typeof manifest.parameters).toBe('object');
		}
	});

	it('has no duplicate tool names', () => {
		const manifests = getToolManifests();
		const names = manifests.map((m) => m.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('includes PM tools', () => {
		const manifests = getToolManifests();
		const names = manifests.map((m) => m.name);
		expect(names).toContain('ReadWorkItem');
		expect(names).toContain('PostComment');
		expect(names).toContain('UpdateWorkItem');
		expect(names).toContain('CreateWorkItem');
		expect(names).toContain('ReportFriction');
		expect(names).toContain('ListWorkItems');
		expect(names).toContain('AddChecklist');
		expect(names).toContain('MoveWorkItem');
		expect(names).toContain('PMUpdateChecklistItem');
		expect(names).toContain('PMDeleteChecklistItem');
	});

	it('ReportFriction has free-form string category/severity and details-file support', () => {
		// 2026-05-10: category/severity were originally enum-typed but
		// loosened to free-form strings after prod run `ff6adf00` showed
		// agents misreading the gadget describe text. The manifest already
		// emitted `type: 'string'` for these (manifest generator coerces
		// enum → string); the underlying gadget def now matches.
		const manifests = getToolManifests();
		const reportFriction = manifests.find((m) => m.name === 'ReportFriction');
		expect(reportFriction).toBeDefined();
		expect(reportFriction?.cliCommand).toBe('cascade-tools pm report-friction');
		expect(reportFriction?.parameters).toMatchObject({
			summary: { type: 'string', required: true },
			details: { type: 'string', required: true },
			category: { type: 'string', required: true },
			severity: { type: 'string', required: true },
			'details-file': { type: 'string' },
		});
		// Pin no `options` array on the manifest — proves the loosening
		// reached the agent-facing surface.
		const params = reportFriction?.parameters as Record<string, { options?: unknown }>;
		expect(params.category.options).toBeUndefined();
		expect(params.severity.options).toBeUndefined();
	});

	it('includes GitHub PR tools', () => {
		const manifests = getToolManifests();
		const names = manifests.map((m) => m.name);
		expect(names).toContain('CreatePR');
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		expect(names).toContain('GetPRChecks');
		expect(names).toContain('GetPRComments');
		expect(names).toContain('PostPRComment');
		expect(names).toContain('UpdatePRComment');
		expect(names).toContain('ReplyToReviewComment');
		expect(names).toContain('CreatePRReview');
		expect(names).toContain('GetCIRunLogs');
	});

	it('includes Finish tool', () => {
		const manifests = getToolManifests();
		const names = manifests.map((m) => m.name);
		expect(names).toContain('Finish');
	});

	it('all cliCommands start with cascade-tools', () => {
		const manifests = getToolManifests();
		for (const manifest of manifests) {
			expect(manifest.cliCommand).toMatch(/^cascade-tools /);
		}
	});

	it('ReadWorkItem has required workItemId parameter', () => {
		const manifests = getToolManifests();
		const readWorkItem = manifests.find((m) => m.name === 'ReadWorkItem');
		expect(readWorkItem).toBeDefined();
		expect(readWorkItem?.parameters).toMatchObject({
			workItemId: { type: 'string', required: true },
		});
	});

	it('MoveWorkItem has required workItemId and destination parameters', () => {
		const manifests = getToolManifests();
		const moveWorkItem = manifests.find((m) => m.name === 'MoveWorkItem');
		expect(moveWorkItem).toBeDefined();
		expect(moveWorkItem?.parameters).toMatchObject({
			workItemId: { type: 'string', required: true },
			destination: { type: 'string', required: true },
		});
	});

	it('PMDeleteChecklistItem has required workItemId and checkItemId parameters', () => {
		const manifests = getToolManifests();
		const deleteChecklist = manifests.find((m) => m.name === 'PMDeleteChecklistItem');
		expect(deleteChecklist).toBeDefined();
		expect(deleteChecklist?.parameters).toMatchObject({
			workItemId: { type: 'string', required: true },
			checkItemId: { type: 'string', required: true },
		});
	});

	it('GetCIRunLogs has required ref parameter', () => {
		const manifests = getToolManifests();
		const getCIRunLogs = manifests.find((m) => m.name === 'GetCIRunLogs');
		expect(getCIRunLogs).toBeDefined();
		expect(getCIRunLogs?.parameters).toMatchObject({
			ref: { type: 'string', required: true },
		});
	});

	it('CreatePR has required title, body, and head parameters', () => {
		const manifests = getToolManifests();
		const createPR = manifests.find((m) => m.name === 'CreatePR');
		expect(createPR).toBeDefined();
		expect(createPR?.parameters).toMatchObject({
			title: { type: 'string', required: true },
			body: { type: 'string', required: true },
			head: { type: 'string', required: true },
		});
	});

	it('UpdatePRComment has body-file support', () => {
		const manifests = getToolManifests();
		const updatePRComment = manifests.find((m) => m.name === 'UpdatePRComment');
		expect(updatePRComment).toBeDefined();
		expect(updatePRComment?.parameters).toMatchObject({
			body: { type: 'string', required: true },
			'body-file': { type: 'string' },
		});
	});
});
