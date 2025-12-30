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
		expect(result.githubTokenEnv).toBe('GITHUB_TOKEN');
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
		expect(result.defaults.model).toBe('gemini:gemini-2.5-flash');
		expect(result.defaults.maxIterations).toBe(50);
	});

	it('rejects config without projects', () => {
		expect(() => validateConfig({ projects: [] })).toThrow();
	});
});
