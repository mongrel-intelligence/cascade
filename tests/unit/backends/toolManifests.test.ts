import { describe, expect, it } from 'vitest';
import { getToolManifests } from '../../../src/agents/definitions/toolManifests.js';

describe('getToolManifests', () => {
	it('returns an array of tool manifests', () => {
		const manifests = getToolManifests();
		expect(Array.isArray(manifests)).toBe(true);
		expect(manifests.length).toBeGreaterThan(0);
	});

	it('returns exactly 17 tools', () => {
		const manifests = getToolManifests();
		expect(manifests).toHaveLength(17);
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
		expect(names).toContain('UpdateChecklistItem');
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
