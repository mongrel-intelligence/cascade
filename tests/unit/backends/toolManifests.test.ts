import { describe, expect, it } from 'vitest';
import { getToolManifests } from '../../../src/agents/definitions/toolManifests.js';

describe('getToolManifests', () => {
	it('returns an array of tool manifests', () => {
		const manifests = getToolManifests();
		expect(Array.isArray(manifests)).toBe(true);
		expect(manifests.length).toBeGreaterThan(0);
	});

	it('returns exactly 20 tools', () => {
		const manifests = getToolManifests();
		expect(manifests).toHaveLength(20);
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
		expect(names).toContain('ListWorkItems');
		expect(names).toContain('AddChecklist');
		expect(names).toContain('MoveWorkItem');
		expect(names).toContain('PMUpdateChecklistItem');
		expect(names).toContain('PMDeleteChecklistItem');
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

	it('PMDeleteChecklistItem has required workItemId and check-item-id parameters', () => {
		const manifests = getToolManifests();
		const deleteChecklist = manifests.find((m) => m.name === 'PMDeleteChecklistItem');
		expect(deleteChecklist).toBeDefined();
		expect(deleteChecklist?.parameters).toMatchObject({
			workItemId: { type: 'string', required: true },
			'check-item-id': { type: 'string', required: true },
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
});
