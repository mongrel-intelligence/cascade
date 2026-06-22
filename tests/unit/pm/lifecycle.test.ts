import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn().mockResolvedValue('mock-cred'),
	getIntegrationCredentialOrNull: vi.fn().mockResolvedValue(null),
	loadProjectConfigByBoardId: vi.fn().mockResolvedValue(null),
	loadProjectConfigByJiraProjectKey: vi.fn().mockResolvedValue(null),
	findProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((_creds, fn) => fn()),
	trelloClient: {},
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds, fn) => fn()),
	jiraClient: {},
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token, fn) => fn()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn().mockResolvedValue(null),
	deleteTrelloAck: vi.fn().mockResolvedValue(undefined),
	resolveTrelloBotMemberId: vi.fn().mockResolvedValue(null),
	postJiraAck: vi.fn().mockResolvedValue(null),
	deleteJiraAck: vi.fn().mockResolvedValue(undefined),
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

vi.mock('../../../src/utils/safeOperation.js', () => ({
	safeOperation: vi.fn((fn) => fn()),
	silentOperation: vi.fn((fn) => fn()),
}));

// Import after mocks — bootstrap registers integrations with pmRegistry via the canonical path
import '../../../src/integrations/pm/index.js';
import '../../../src/github/register.js';
import '../../../src/sentry/register.js';
import {
	PMLifecycleManager,
	type ProjectPMConfig,
	resolveProjectPMConfig,
} from '../../../src/pm/lifecycle.js';
import type { PMProvider } from '../../../src/pm/types.js';
import type { ProjectConfig } from '../../../src/types/index.js';

describe('pm/lifecycle', () => {
	describe('resolveProjectPMConfig', () => {
		it('returns JIRA config when project type is jira', () => {
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

			const config = resolveProjectPMConfig(project);

			expect(config).toEqual({
				labels: {
					processing: 'cascade-processing',
					processed: 'cascade-processed',
					error: 'cascade-error',
					readyToProcess: 'cascade-ready',
					auto: 'cascade-auto',
				},
				statuses: {
					inProgress: 'In Progress',
					inReview: 'Code Review',
					done: 'Done',
					merged: 'Merged',
				},
			});
		});

		it('returns Trello config when project type is trello', () => {
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
					labels: {
						processing: 'label-proc-id',
						processed: 'label-done-id',
						error: 'label-err-id',
						readyToProcess: 'label-ready-id',
					},
					lists: {
						backlog: 'list-backlog-id',
						todo: 'list-todo-id',
						inProgress: 'list-progress-id',
						inReview: 'list-review-id',
						done: 'list-done-id',
						merged: 'list-merged-id',
					},
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config).toEqual({
				labels: {
					processing: 'label-proc-id',
					processed: 'label-done-id',
					error: 'label-err-id',
					readyToProcess: 'label-ready-id',
				},
				// Trello's lifecycle config now spreads the full lists record so
				// every configured key (including custom ones like `todo`) survives
				// normalization for use by `moveOnPrepare` / `moveOnSuccess` hooks.
				statuses: {
					backlog: 'list-backlog-id',
					todo: 'list-todo-id',
					inProgress: 'list-progress-id',
					inReview: 'list-review-id',
					done: 'list-done-id',
					merged: 'list-merged-id',
				},
			});
		});

		it('returns an empty config when pm is undefined, even with a trello block (SCM-only)', () => {
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

			const config = resolveProjectPMConfig(project);

			expect(config).toEqual({ labels: {}, statuses: {} });
		});

		it('returns JIRA config with custom labels when configured', () => {
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
					labels: {
						processing: 'my-processing',
						processed: 'my-processed',
						error: 'my-error',
						readyToProcess: 'my-ready',
					},
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.labels).toEqual({
				processing: 'my-processing',
				processed: 'my-processed',
				error: 'my-error',
				readyToProcess: 'my-ready',
				auto: 'cascade-auto',
			});
		});

		it('falls back to defaults when JIRA labels are partially configured', () => {
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
					statuses: { inProgress: 'In Progress' },
					labels: {
						processing: 'custom-processing',
						// others not set — defaults should be used
					},
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.labels.processing).toBe('custom-processing');
			expect(config.labels.processed).toBe('cascade-processed');
			expect(config.labels.error).toBe('cascade-error');
			expect(config.labels.readyToProcess).toBe('cascade-ready');
		});

		it('uses defaults when JIRA labels property is undefined', () => {
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
					statuses: { inProgress: 'In Progress' },
					// no labels property at all
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.labels).toEqual({
				processing: 'cascade-processing',
				processed: 'cascade-processed',
				error: 'cascade-error',
				readyToProcess: 'cascade-ready',
				auto: 'cascade-auto',
			});
		});

		it('handles missing optional Trello labels and lists', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Partial Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'trello' },
				trello: {
					boardId: 'board123',
					labels: {},
					lists: { todo: 'list-id' },
				},
			};

			const config = resolveProjectPMConfig(project);

			// Trello statuses are now spread from the configured lists record;
			// keys that were never configured are simply absent rather than
			// explicitly `undefined`.
			expect(config).toEqual({
				labels: {
					processing: undefined,
					processed: undefined,
					error: undefined,
					readyToProcess: undefined,
				},
				statuses: {
					todo: 'list-id',
				},
			});
		});
		it('resolves backlog status for Trello projects', () => {
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
					labels: {},
					lists: {
						backlog: 'list-backlog-id',
						todo: 'list-todo-id',
					},
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.statuses.backlog).toBe('list-backlog-id');
		});

		it('resolves backlog status for JIRA projects', () => {
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
						backlog: 'Backlog',
						inProgress: 'In Progress',
					},
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.statuses.backlog).toBe('Backlog');
		});

		it('returns undefined backlog for Trello projects without backlog configured', () => {
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
					labels: {},
					lists: { todo: 'list-todo-id' },
				},
			};

			const config = resolveProjectPMConfig(project);

			expect(config.statuses.backlog).toBeUndefined();
		});
	});

	describe('PMLifecycleManager', () => {
		let mockProvider: PMProvider;
		let pmConfig: ProjectPMConfig;
		let manager: PMLifecycleManager;

		beforeEach(() => {
			// Create mock provider with all required methods
			mockProvider = {
				type: 'trello',
				addLabel: vi.fn().mockResolvedValue(undefined),
				removeLabel: vi.fn().mockResolvedValue(undefined),
				moveWorkItem: vi.fn().mockResolvedValue(undefined),
				addComment: vi.fn().mockResolvedValue(undefined),
				updateComment: vi.fn().mockResolvedValue(undefined),
				linkPR: vi.fn().mockResolvedValue(undefined),
				// Other PMProvider methods (not used by lifecycle manager)
				getWorkItem: vi.fn(),
				getWorkItemComments: vi.fn(),
				updateWorkItem: vi.fn(),
				createWorkItem: vi.fn(),
				listWorkItems: vi.fn(),
				getChecklists: vi.fn(),
				createChecklist: vi.fn(),
				addChecklistItem: vi.fn(),
				updateChecklistItem: vi.fn(),
				getAttachments: vi.fn(),
				addAttachment: vi.fn(),
				addAttachmentFile: vi.fn(),
				getCustomFieldNumber: vi.fn(),
				updateCustomFieldNumber: vi.fn(),
				getWorkItemUrl: vi.fn(),
				getAuthenticatedUser: vi.fn(),
			};

			pmConfig = {
				labels: {
					processing: 'label-proc',
					processed: 'label-done',
					error: 'label-error',
					readyToProcess: 'label-ready',
				},
				statuses: {
					inProgress: 'list-progress',
					inReview: 'list-review',
					done: 'list-done',
					merged: 'list-merged',
				},
			};

			manager = new PMLifecycleManager(mockProvider, pmConfig);
		});

		describe('prepareForAgent', () => {
			it('adds processing label and removes ready/processed labels', async () => {
				await manager.prepareForAgent('work-item-1', {});

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-proc');
				expect(mockProvider.removeLabel).toHaveBeenCalledWith('work-item-1', 'label-ready');
				expect(mockProvider.removeLabel).toHaveBeenCalledWith('work-item-1', 'label-done');
			});

			it('moves to inProgress status when moveOnPrepare is set to inProgress', async () => {
				await manager.prepareForAgent('work-item-1', { moveOnPrepare: 'inProgress' });

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-proc');
				expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'list-progress');
			});

			it('moves to custom status keys when moveOnPrepare uses a custom workflow status', async () => {
				pmConfig.statuses.story = 'state-story';

				await manager.prepareForAgent('work-item-1', { moveOnPrepare: 'story' });

				expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'state-story');
			});

			it('does not move work item when moveOnPrepare is not set', async () => {
				await manager.prepareForAgent('work-item-1', {});

				expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			});

			it('skips operations when labels are undefined', async () => {
				const managerNoLabels = new PMLifecycleManager(mockProvider, {
					labels: {},
					statuses: {},
				});

				await managerNoLabels.prepareForAgent('work-item-1', {});

				expect(mockProvider.addLabel).not.toHaveBeenCalled();
				expect(mockProvider.removeLabel).not.toHaveBeenCalled();
			});
		});

		describe('handleSuccess', () => {
			it('adds processed label', async () => {
				await manager.handleSuccess('work-item-1', {});

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-done');
			});

			it('moves to inReview status when moveOnSuccess is set to inReview', async () => {
				await manager.handleSuccess('work-item-1', { moveOnSuccess: 'inReview' });

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-done');
				expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'list-review');
			});

			it('moves to custom status keys when moveOnSuccess uses a custom workflow status', async () => {
				pmConfig.statuses['phased-plan'] = 'state-phased-plan';

				await manager.handleSuccess('work-item-1', { moveOnSuccess: 'phased-plan' });

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-done');
				expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('work-item-1', 'state-phased-plan');
			});

			it('calls linkPR when prUrl is provided and linkPR hook is true', async () => {
				await manager.handleSuccess(
					'work-item-1',
					{ linkPR: true },
					'https://github.com/owner/repo/pull/123',
				);

				expect(mockProvider.linkPR).toHaveBeenCalledWith(
					'work-item-1',
					'https://github.com/owner/repo/pull/123',
					'Pull Request #123',
				);
			});

			it('does not post comment when linkPR succeeds', async () => {
				await manager.handleSuccess('work-item-1', { linkPR: true }, 'https://github.com/pr/123');

				expect(mockProvider.addComment).not.toHaveBeenCalled();
				expect(mockProvider.updateComment).not.toHaveBeenCalled();
			});

			it('does not call linkPR when prUrl is not provided', async () => {
				await manager.handleSuccess('work-item-1', { linkPR: true });

				expect(mockProvider.linkPR).not.toHaveBeenCalled();
				expect(mockProvider.addComment).not.toHaveBeenCalled();
			});

			it('does not move work item when moveOnSuccess is not set', async () => {
				await manager.handleSuccess('work-item-1', {});

				expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			});

			it('does not call linkPR when linkPR hook is not set even with prUrl', async () => {
				await manager.handleSuccess('work-item-1', {}, 'https://github.com/pr/123');

				expect(mockProvider.linkPR).not.toHaveBeenCalled();
			});

			it('falls back to addComment when linkPR fails and no progressCommentId', async () => {
				vi.mocked(mockProvider.linkPR).mockRejectedValue(new Error('Permission denied'));

				await manager.handleSuccess(
					'work-item-1',
					{ linkPR: true },
					'https://github.com/owner/repo/pull/123',
				);

				expect(mockProvider.linkPR).toHaveBeenCalledWith(
					'work-item-1',
					'https://github.com/owner/repo/pull/123',
					'Pull Request #123',
				);
				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'PR created: https://github.com/owner/repo/pull/123',
				);
			});

			it('falls back to updateComment when linkPR fails and progressCommentId provided', async () => {
				vi.mocked(mockProvider.linkPR).mockRejectedValue(new Error('Permission denied'));

				await manager.handleSuccess(
					'work-item-1',
					{ linkPR: true },
					'https://github.com/pr/123',
					'comment-abc',
				);

				expect(mockProvider.linkPR).toHaveBeenCalled();
				expect(mockProvider.updateComment).toHaveBeenCalledWith(
					'work-item-1',
					'comment-abc',
					'PR created: https://github.com/pr/123',
				);
				expect(mockProvider.addComment).not.toHaveBeenCalled();
			});

			it('falls back to addComment when linkPR fails and updateComment also fails', async () => {
				vi.mocked(mockProvider.linkPR).mockRejectedValue(new Error('Permission denied'));
				vi.mocked(mockProvider.updateComment).mockRejectedValue(new Error('Comment not found'));

				await manager.handleSuccess(
					'work-item-1',
					{ linkPR: true },
					'https://github.com/pr/123',
					'comment-abc',
				);

				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'PR created: https://github.com/pr/123',
				);
			});
		});

		describe('handleFailure', () => {
			it('adds error label', async () => {
				await manager.handleFailure('work-item-1');

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-error');
			});

			it('adds error comment when error message is provided', async () => {
				await manager.handleFailure('work-item-1', 'Something went wrong');

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-error');
				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'❌ Agent failed: Something went wrong',
				);
			});

			it('does not add comment when error message is not provided', async () => {
				await manager.handleFailure('work-item-1');

				expect(mockProvider.addComment).not.toHaveBeenCalled();
			});
		});

		describe('handleBudgetExceeded', () => {
			it('removes processing label and adds error label', async () => {
				await manager.handleBudgetExceeded('work-item-1', 5.5, 5.0);

				expect(mockProvider.removeLabel).toHaveBeenCalledWith('work-item-1', 'label-proc');
				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-error');
			});

			it('adds budget exceeded comment with formatted amounts', async () => {
				await manager.handleBudgetExceeded('work-item-1', 5.678, 5.0);

				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'⛔ Budget exceeded: cost $5.68 >= limit $5.00. Agent not started.',
				);
			});
		});

		describe('handleBudgetWarning', () => {
			it('adds error label', async () => {
				await manager.handleBudgetWarning('work-item-1', 4.95, 5.0);

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-error');
			});

			it('adds budget warning comment with formatted amounts', async () => {
				await manager.handleBudgetWarning('work-item-1', 5.123, 5.0);

				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'⚠️ Budget limit reached: cost $5.12 >= limit $5.00. Further agent runs will be blocked.',
				);
			});
		});

		describe('cleanupProcessing', () => {
			it('removes processing label', async () => {
				await manager.cleanupProcessing('work-item-1');

				expect(mockProvider.removeLabel).toHaveBeenCalledWith('work-item-1', 'label-proc');
			});
		});

		describe('handleError', () => {
			it('adds error label and error comment', async () => {
				await manager.handleError('work-item-1', 'Database connection failed');

				expect(mockProvider.addLabel).toHaveBeenCalledWith('work-item-1', 'label-error');
				expect(mockProvider.addComment).toHaveBeenCalledWith(
					'work-item-1',
					'❌ Error: Database connection failed',
				);
			});
		});
	});

	// =========================================================================
	// End-to-end: provider-normalized config + PMLifecycleManager move hooks
	//
	// These tests guarantee that custom workflow keys (`prd`, `story`,
	// `phased-plan`) configured on a real Trello / JIRA project survive
	// resolveProjectPMConfig normalization AND remain resolvable when a
	// LifecycleHook (`moveOnPrepare` / `moveOnSuccess`) references them.
	// =========================================================================
	describe('resolveProjectPMConfig → PMLifecycleManager custom workflow moves', () => {
		function makeMockProvider(type: 'trello' | 'jira'): PMProvider {
			return {
				type,
				addLabel: vi.fn().mockResolvedValue(undefined),
				removeLabel: vi.fn().mockResolvedValue(undefined),
				moveWorkItem: vi.fn().mockResolvedValue(undefined),
				addComment: vi.fn().mockResolvedValue(undefined),
				updateComment: vi.fn().mockResolvedValue(undefined),
				linkPR: vi.fn().mockResolvedValue(undefined),
				getWorkItem: vi.fn(),
				getWorkItemComments: vi.fn(),
				updateWorkItem: vi.fn(),
				createWorkItem: vi.fn(),
				listWorkItems: vi.fn(),
				getChecklists: vi.fn(),
				createChecklist: vi.fn(),
				addChecklistItem: vi.fn(),
				updateChecklistItem: vi.fn(),
				getAttachments: vi.fn(),
				addAttachment: vi.fn(),
				addAttachmentFile: vi.fn(),
				getCustomFieldNumber: vi.fn(),
				updateCustomFieldNumber: vi.fn(),
				getWorkItemUrl: vi.fn(),
				getAuthenticatedUser: vi.fn(),
			} as unknown as PMProvider;
		}

		it('moves a Trello card via moveOnPrepare to a custom story status', async () => {
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
					labels: {},
					lists: {
						backlog: 'list-backlog',
						inProgress: 'list-progress',
						story: 'list-story',
						'phased-plan': 'list-phased-plan',
					},
				},
			};

			const pmConfig = resolveProjectPMConfig(project);
			expect(pmConfig.statuses.story).toBe('list-story');
			expect(pmConfig.statuses['phased-plan']).toBe('list-phased-plan');

			const provider = makeMockProvider('trello');
			const manager = new PMLifecycleManager(provider, pmConfig);

			await manager.prepareForAgent('card-1', { moveOnPrepare: 'story' });

			expect(provider.moveWorkItem).toHaveBeenCalledWith('card-1', 'list-story');
		});

		it('moves a Trello card via moveOnSuccess to a custom phased-plan status', async () => {
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
					labels: {},
					lists: {
						inProgress: 'list-progress',
						'phased-plan': 'list-phased-plan',
						prd: 'list-prd',
					},
				},
			};

			const pmConfig = resolveProjectPMConfig(project);

			const provider = makeMockProvider('trello');
			const manager = new PMLifecycleManager(provider, pmConfig);

			await manager.handleSuccess('card-1', { moveOnSuccess: 'phased-plan' });

			expect(provider.moveWorkItem).toHaveBeenCalledWith('card-1', 'list-phased-plan');
		});

		it('moves a JIRA issue via moveOnPrepare to a custom prd status', async () => {
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
						prd: 'PRD Review',
						story: 'Story Refinement',
						'phased-plan': 'Phased Planning',
					},
				},
			};

			const pmConfig = resolveProjectPMConfig(project);
			expect(pmConfig.statuses.prd).toBe('PRD Review');

			const provider = makeMockProvider('jira');
			const manager = new PMLifecycleManager(provider, pmConfig);

			await manager.prepareForAgent('PROJ-1', { moveOnPrepare: 'prd' });

			expect(provider.moveWorkItem).toHaveBeenCalledWith('PROJ-1', 'PRD Review');
		});

		it('moves a JIRA issue via moveOnSuccess to a custom story status', async () => {
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
						story: 'Story Refinement',
					},
				},
			};

			const pmConfig = resolveProjectPMConfig(project);

			const provider = makeMockProvider('jira');
			const manager = new PMLifecycleManager(provider, pmConfig);

			await manager.handleSuccess('PROJ-1', { moveOnSuccess: 'story' });

			expect(provider.moveWorkItem).toHaveBeenCalledWith('PROJ-1', 'Story Refinement');
		});

		it('skips the move when the custom status key is not configured on the project', async () => {
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
					labels: {},
					lists: { inProgress: 'list-progress' }, // no `story`
				},
			};

			const pmConfig = resolveProjectPMConfig(project);
			expect(pmConfig.statuses.story).toBeUndefined();

			const provider = makeMockProvider('trello');
			const manager = new PMLifecycleManager(provider, pmConfig);

			await manager.prepareForAgent('card-1', { moveOnPrepare: 'story' });

			// Provider's moveWorkItem must not be called when the destination is undefined.
			expect(provider.moveWorkItem).not.toHaveBeenCalled();
		});
	});
});
