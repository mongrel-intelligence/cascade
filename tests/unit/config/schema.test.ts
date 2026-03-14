import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema, validateConfig } from '../../../src/config/schema.js';

describe('ProjectConfigSchema', () => {
	it('validates a valid project config', () => {
		const config = {
			id: 'test-project',
			orgId: 'default',
			name: 'Test Project',
			repo: 'owner/repo',
			trello: {
				boardId: 'board123',
				lists: {
					splitting: 'list1',
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
			orgId: 'default',
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
			orgId: 'default',
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

	it('accepts agentEngine with default and overrides', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentEngine: {
				default: 'claude-code',
				overrides: { review: 'llmist' },
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentEngine?.default).toBe('claude-code');
		expect(result.agentEngine?.overrides).toEqual({ review: 'llmist' });
	});

	it('works without agentEngine (optional field)', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentEngine).toBeUndefined();
	});

	it('accepts codex engine settings on project config', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			engineSettings: {
				codex: {
					approvalPolicy: 'never',
					sandboxMode: 'workspace-write',
					webSearch: false,
				},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.engineSettings?.codex?.approvalPolicy).toBe('never');
		expect(result.engineSettings?.codex?.sandboxMode).toBe('workspace-write');
		expect(result.engineSettings?.codex?.webSearch).toBe(false);
	});

	it('accepts opencode engine settings on project config', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			engineSettings: {
				opencode: {
					webSearch: true,
				},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.engineSettings?.opencode?.webSearch).toBe(true);
	});

	it('rejects unsupported engine settings on project config', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			engineSettings: {
				unknownEngine: {
					foo: 'bar',
				},
			},
		};

		expect(() => ProjectConfigSchema.parse(config)).toThrow('Unsupported engine settings');
	});

	it('applies default "llmist" for agentEngine.default when object provided', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			agentEngine: {},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.agentEngine?.default).toBe('llmist');
		expect(result.agentEngine?.overrides).toEqual({});
	});

	it('validates JIRA config with labels', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			jira: {
				projectKey: 'TEST',
				baseUrl: 'https://test.atlassian.net',
				statuses: { splitting: 'Briefing' },
				labels: {
					processing: 'my-processing',
					processed: 'my-processed',
					error: 'my-error',
					readyToProcess: 'my-ready',
				},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.jira?.labels?.processing).toBe('my-processing');
		expect(result.jira?.labels?.readyToProcess).toBe('my-ready');
	});

	it('applies default label values when labels object provided without values', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			jira: {
				projectKey: 'TEST',
				baseUrl: 'https://test.atlassian.net',
				statuses: { splitting: 'Briefing' },
				labels: {},
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.jira?.labels?.processing).toBe('cascade-processing');
		expect(result.jira?.labels?.processed).toBe('cascade-processed');
		expect(result.jira?.labels?.error).toBe('cascade-error');
		expect(result.jira?.labels?.readyToProcess).toBe('cascade-ready');
	});

	it('accepts JIRA config without labels (optional)', () => {
		const config = {
			id: 'test',
			orgId: 'default',
			name: 'Test',
			repo: 'owner/repo',
			jira: {
				projectKey: 'TEST',
				baseUrl: 'https://test.atlassian.net',
				statuses: { splitting: 'Briefing' },
			},
		};

		const result = ProjectConfigSchema.parse(config);
		expect(result.jira?.labels).toBeUndefined();
	});
});

describe('validateConfig', () => {
	it('validates a complete cascade config', () => {
		const config = {
			projects: [
				{
					id: 'test',
					orgId: 'default',
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
		expect(result.projects[0].model).toBe('openrouter:google/gemini-3-flash-preview');
		expect(result.projects[0].maxIterations).toBe(50);
	});

	it('rejects config without projects', () => {
		expect(() => validateConfig({ projects: [] })).toThrow();
	});

	it('applies default "llmist" for project agentEngine.default', () => {
		const config = {
			projects: [
				{
					id: 'test',
					orgId: 'default',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
					agentEngine: {},
				},
			],
		};

		const result = validateConfig(config);
		expect(result.projects[0].agentEngine?.default).toBe('llmist');
	});

	it('accepts custom project agentEngine value', () => {
		const config = {
			projects: [
				{
					id: 'test',
					orgId: 'default',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
					agentEngine: { default: 'claude-code' },
				},
			],
		};

		const result = validateConfig(config);
		expect(result.projects[0].agentEngine?.default).toBe('claude-code');
	});

	it('accepts project engineSettings for codex', () => {
		const config = {
			projects: [
				{
					id: 'test',
					orgId: 'default',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
					engineSettings: {
						codex: {
							approvalPolicy: 'never',
							reasoningEffort: 'high',
						},
					},
				},
			],
		};

		const result = validateConfig(config);
		expect(result.projects[0].engineSettings?.codex?.approvalPolicy).toBe('never');
		expect(result.projects[0].engineSettings?.codex?.reasoningEffort).toBe('high');
	});

	it('accepts project engineSettings for opencode', () => {
		const result = validateConfig({
			projects: [
				{
					id: 'p1',
					orgId: 'org-1',
					name: 'Project',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
					engineSettings: {
						opencode: {
							webSearch: true,
						},
					},
				},
			],
		});

		expect(result.projects[0].engineSettings?.opencode?.webSearch).toBe(true);
	});

	it('rejects unsupported project engineSettings entries', () => {
		const config = {
			projects: [
				{
					id: 'test',
					orgId: 'default',
					name: 'Test',
					repo: 'owner/repo',
					trello: { boardId: 'b1', lists: {}, labels: {} },
					engineSettings: {
						'claude-code': {
							foo: 'bar',
						},
					},
				},
			],
		};

		expect(() => validateConfig(config)).toThrow('Unsupported engine settings');
	});
});
