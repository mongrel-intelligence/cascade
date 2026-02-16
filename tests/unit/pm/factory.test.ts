import { describe, expect, it, vi } from 'vitest';
import { createPMProvider } from '../../../src/pm/factory.js';
import type { ProjectConfig } from '../../../src/types/index.js';

// Mock the adapters
vi.mock('../../../src/pm/trello/adapter.js', () => ({
	TrelloPMProvider: vi.fn().mockImplementation(() => ({
		type: 'trello',
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
	})),
}));

vi.mock('../../../src/pm/jira/adapter.js', () => ({
	JiraPMProvider: vi.fn().mockImplementation((config) => ({
		type: 'jira',
		config,
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
	})),
}));

import { JiraPMProvider } from '../../../src/pm/jira/adapter.js';
import { TrelloPMProvider } from '../../../src/pm/trello/adapter.js';

describe('pm/factory', () => {
	describe('createPMProvider', () => {
		it('returns TrelloPMProvider when pm.type is trello', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Trello Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'trello' },
				trello: {
					boardId: 'board123',
					labels: { processing: 'label-id' },
					lists: { todo: 'list-id' },
				},
			};

			const provider = createPMProvider(project);

			expect(TrelloPMProvider).toHaveBeenCalled();
			expect(provider.type).toBe('trello');
		});

		it('returns TrelloPMProvider when pm.type is undefined (defaults to trello)', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Default Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				trello: {
					boardId: 'board123',
					labels: { processing: 'label-id' },
					lists: { todo: 'list-id' },
				},
			};

			const provider = createPMProvider(project);

			expect(TrelloPMProvider).toHaveBeenCalled();
			expect(provider.type).toBe('trello');
		});

		it('returns JiraPMProvider when pm.type is jira', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'JIRA Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'jira' },
				jira: {
					projectKey: 'PROJ',
					statuses: {
						inProgress: 'In Progress',
						inReview: 'Code Review',
						done: 'Done',
						merged: 'Merged',
					},
				},
			};

			const provider = createPMProvider(project);

			expect(JiraPMProvider).toHaveBeenCalledWith(project.jira);
			expect(provider.type).toBe('jira');
		});

		it('throws error when pm.type is jira but jira config is missing', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Invalid JIRA Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'jira' },
				// No jira config
			};

			expect(() => createPMProvider(project)).toThrow(
				"Project 'proj1' has pm.type=jira but no jira config",
			);
		});

		it('throws error for unknown pm.type', () => {
			const project = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Unknown PM Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'unknown' },
			} as ProjectConfig;

			expect(() => createPMProvider(project)).toThrow('Unknown PM type: unknown');
		});
	});
});
