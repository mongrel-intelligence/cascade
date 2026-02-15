import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema, validateConfig } from '../../../src/config/schema.js';

describe('ProjectConfigSchema', () => {
	it('validates a valid project config', () => {
		const config = {
			id: 'test-project',
			name: 'Test Project',
			repo: 'owner/repo',
			trello: {
				boardId: 'board123',
				lists: {
					briefing: 'list1',
					planning: 'list2',
					todo: 'list3',
				},
				labels: {
					processing: 'label1',
				},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.id).toBe('test-project');
		expect(result.baseBranch).toBe('main');
		expect(result.branchPrefix).toBe('feature/');
	});

	it('rejects invalid repo format', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'invalid-repo-format',
			trello: {
				boardId: 'board123',
				lists: {},
				labels: {},
			},
		};

		expect(() => ProjectConfigSchema.parse(config)).toThrow();
	});

	it('applies default values', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: {
				boardId: 'board123',
				lists: {},
				labels: {},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.baseBranch).toBe('main');
		expect(result.branchPrefix).toBe('feature/');
	});

	it('accepts agentBackend with default and overrides', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentBackend: {
				default: 'claude-code',
				overrides: { review: 'llmist' },
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentBackend?.default).toBe('claude-code');
		expect(result.agentBackend?.overrides).toEqual({ review: 'llmist' });
	});

	it('works without agentBackend (optional field)', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentBackend).toBeUndefined();
	});

	it('accepts subscriptionCostZero on agentBackend', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentBackend: {
				default: 'claude-code',
				subscriptionCostZero: true,
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentBackend?.subscriptionCostZero).toBe(true);
	});

	it('defaults subscriptionCostZero to false', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentBackend: {
				default: 'claude-code',
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentBackend?.subscriptionCostZero).toBe(false);
	});

	it('applies default "llmist" for agentBackend.default when object provided', () => {
		const config = {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentBackend: {},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentBackend?.default).toBe('llmist');
		expect(result.agentBackend?.overrides).toEqual({});
	});
});

describe('validateConfig', () => {
	it('validates a complete cascade config', () => {
		const config = {
			projects: [
				{
					id: 'test',
					name: 'Test',
					repo: 'owner/repo',
					trello: {
						boardId: 'board123',
						lists: { todo: 'list1' },
						labels: { processing: 'label1' },
					},
				},
			],
		};

		const result = validateConfig(config);
		expect(result.projects).toHaveLength(1);
		expect(result.defaults.model).toBe('openrouter:google/gemini-3-flash-preview');
		expect(result.defaults.maxIterations).toBe(50);
	});

	it('rejects config without projects', () => {
		expect(() => validateConfig({ projects: [] })).toThrow();
	});

	it('applies default "llmist" for defaults.agentBackend', () => {
		const config = {
			projects: [
				{
					id: 'test',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
				},
			],
		};

		const result = validateConfig(config);
		expect(result.defaults.agentBackend).toBe('llmist');
	});

	it('accepts custom defaults.agentBackend value', () => {
		const config = {
			defaults: {
				agentBackend: 'claude-code',
			},
			projects: [
				{
					id: 'test',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
				},
			],
		};

		const result = validateConfig(config);
		expect(result.defaults.agentBackend).toBe('claude-code');
	});
});
