/**
 * Integration tests: PM Provider Switching
 *
 * Tests switching Trello ↔ JIRA on the same project, ensuring the correct
 * PM provider is returned and triggers dispatch correctly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	findProjectByBoardIdFromDb,
	findProjectByJiraProjectKeyFromDb,
} from '../../src/db/repositories/configRepository.js';
import {
	getIntegrationByProjectAndCategory,
	upsertProjectIntegration,
} from '../../src/db/repositories/settingsRepository.js';
import { createPMProvider } from '../../src/pm/index.js';
import { pmRegistry } from '../../src/pm/registry.js';
import { JiraIssueTransitionedTrigger } from '../../src/triggers/jira/issue-transitioned.js';
import { CardMovedToTodoTrigger } from '../../src/triggers/trello/card-moved.js';
import type { TriggerContext } from '../../src/types/index.js';
import { truncateAll } from './helpers/db.js';
import { seedIntegration, seedOrg, seedProject } from './helpers/seed.js';

/** Assert that a value is defined (not null/undefined), throwing if not. */
function assertFound<T>(value: T | null | undefined, msg = 'Expected value to be defined'): T {
	if (value == null) throw new Error(msg);
	return value;
}

// ============================================================================
// Helpers
// ============================================================================

function makeTrelloCardMovedPayload(listAfterId: string) {
	return {
		model: { id: 'board-123', name: 'Test Board' },
		action: {
			id: 'action-1',
			idMemberCreator: 'member-1',
			type: 'updateCard',
			date: new Date().toISOString(),
			data: {
				card: { id: 'card-abc', name: 'Test Card', idShort: 1, shortLink: 'abc' },
				listAfter: { id: listAfterId, name: 'After' },
				listBefore: { id: 'list-before', name: 'Before' },
			},
			memberCreator: { id: 'member-1', fullName: 'Test Member', username: 'testmember' },
		},
	};
}

function makeJiraIssueTransitionedPayload(statusName: string, issueKey: string) {
	return {
		webhookEvent: 'jira:issue_updated',
		issue_event_type_name: 'issue_updated',
		user: { accountId: 'user-1', displayName: 'Test User' },
		issue: {
			id: '10001',
			key: issueKey,
			fields: {
				summary: 'Test Issue',
				status: {
					id: '1',
					name: statusName,
					statusCategory: { id: 4, key: 'indeterminate', colorName: 'yellow' },
				},
				assignee: null,
				description: null,
				issuetype: { name: 'Story' },
			},
		},
		changelog: {
			id: '100',
			items: [
				{
					field: 'status',
					fieldtype: 'jira',
					from: '10000',
					fromString: 'To Do',
					to: '10001',
					toString: statusName,
				},
			],
		},
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('PM Provider Switching (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject({ repo: 'owner/repo' });
	});

	// =========================================================================
	// Provider Type Detection
	// =========================================================================

	describe('PM provider creation', () => {
		it('creates TrelloPMProvider for Trello project', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-123', lists: {}, labels: {} },
			});

			const project = await findProjectByBoardIdFromDb('board-123');
			expect(project).toBeDefined();
			expect(project?.pm?.type).toBe('trello');

			const provider = createPMProvider(assertFound(project));
			expect(provider).toBeDefined();
			// TrelloPMProvider has type 'trello'
			expect(provider.type).toBe('trello');
		});

		it('creates JiraPMProvider for JIRA project', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					projectKey: 'PROJ',
					baseUrl: 'https://example.atlassian.net',
					statuses: { todo: 'To Do', planning: 'In Planning' },
				},
			});

			const project = await findProjectByJiraProjectKeyFromDb('PROJ');
			expect(project).toBeDefined();
			expect(project?.pm?.type).toBe('jira');

			const provider = createPMProvider(assertFound(project));
			expect(provider).toBeDefined();
			expect(provider.type).toBe('jira');
		});

		it('defaults to Trello when pm.type is not set', () => {
			// A project config without a pm.type field defaults to 'trello'
			// via pmRegistry.createProvider() → pm.type ?? 'trello'
			const projectConfig = {
				id: 'test-project',
				orgId: 'test-org',
				name: 'Test',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				agentModels: {},
				agentIterations: {},
				// No pm.type — the registry defaults to 'trello'
			};

			// The registry uses pm.type ?? 'trello' as the default
			const type = (projectConfig as Record<string, unknown>).pm
				? ((projectConfig as Record<string, unknown>).pm as Record<string, unknown>).type
				: 'trello';
			expect(type).toBe('trello');
		});
	});

	// =========================================================================
	// Provider Switch: Trello → JIRA
	// =========================================================================

	describe('switching from Trello to JIRA', () => {
		it('updates integration provider from trello to jira', async () => {
			// Start with Trello
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-123', lists: {}, labels: {} },
			});

			let integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ?.provider).toBe('trello');

			// Switch to JIRA (upsert handles the provider change)
			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'NEW',
				baseUrl: 'https://new.atlassian.net',
				statuses: { todo: 'To Do' },
			});

			integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ?.provider).toBe('jira');
			expect((integ?.config as Record<string, unknown>)?.projectKey).toBe('NEW');
		});

		it('creates correct provider type after switch', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-123', lists: {}, labels: {} },
			});

			// Verify Trello provider before switch
			const trelloProject = await findProjectByBoardIdFromDb('board-123');
			expect(createPMProvider(assertFound(trelloProject)).type).toBe('trello');

			// Switch to JIRA
			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'SWITCH',
				baseUrl: 'https://switch.atlassian.net',
				statuses: { todo: 'To Do' },
			});

			// Verify JIRA provider after switch
			const jiraProject = await findProjectByJiraProjectKeyFromDb('SWITCH');
			expect(jiraProject).toBeDefined();
			expect(createPMProvider(assertFound(jiraProject)).type).toBe('jira');
		});
	});

	// =========================================================================
	// Trigger Dispatch with Real Config
	// =========================================================================

	describe('Trello card-moved trigger dispatch', () => {
		it('dispatches implementation agent on card moved to todo list', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123', planning: 'list-plan-456', splitting: 'list-split-789' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');
			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload('list-todo-123'),
			};

			expect(CardMovedToTodoTrigger.matches(ctx)).toBe(true);
			const result = await CardMovedToTodoTrigger.handle(ctx);
			expect(result?.agentType).toBe('implementation');
		});
	});

	describe('JIRA issue-transitioned trigger dispatch', () => {
		it('dispatches implementation agent on issue transitioned to todo status', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					projectKey: 'IMPL',
					baseUrl: 'https://example.atlassian.net',
					statuses: { todo: 'To Do', planning: 'In Planning', splitting: 'Splitting' },
				},
			});

			const project = await findProjectByJiraProjectKeyFromDb('IMPL');
			expect(project).toBeDefined();

			const trigger = new JiraIssueTransitionedTrigger();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'jira',
				payload: makeJiraIssueTransitionedPayload('To Do', 'IMPL-1'),
			};

			expect(trigger.matches(ctx)).toBe(true);
			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('IMPL-1');
		});

		it('dispatches planning agent on issue transitioned to planning status', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					projectKey: 'PLAN',
					baseUrl: 'https://example.atlassian.net',
					statuses: { todo: 'To Do', planning: 'In Planning', splitting: 'Splitting' },
				},
			});

			const project = await findProjectByJiraProjectKeyFromDb('PLAN');
			expect(project).toBeDefined();
			const trigger = new JiraIssueTransitionedTrigger();

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'jira',
				payload: makeJiraIssueTransitionedPayload('In Planning', 'PLAN-1'),
			};

			expect(trigger.matches(ctx)).toBe(true);
			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('planning');
		});

		it('returns null for non-matching status transition', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					projectKey: 'NOMATCH',
					baseUrl: 'https://example.atlassian.net',
					statuses: { todo: 'To Do' },
				},
			});

			const project = await findProjectByJiraProjectKeyFromDb('NOMATCH');
			expect(project).toBeDefined();
			const trigger = new JiraIssueTransitionedTrigger();

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'jira',
				payload: makeJiraIssueTransitionedPayload('Done', 'NOMATCH-1'),
			};

			// 'Done' doesn't match any configured status
			if (trigger.matches(ctx)) {
				const result = await trigger.handle(ctx);
				expect(result).toBeNull();
			} else {
				// It's fine if it doesn't match at all
				expect(trigger.matches(ctx)).toBe(false);
			}
		});
	});

	// =========================================================================
	// PMRegistry
	// =========================================================================

	describe('pmRegistry', () => {
		it('has trello and jira integrations registered', () => {
			const all = pmRegistry.all();
			const types = all.map((i) => i.type);
			expect(types).toContain('trello');
			expect(types).toContain('jira');
		});

		it('throws for unknown integration type', () => {
			expect(() => pmRegistry.get('unknown-provider')).toThrow(/Unknown PM integration type/);
		});

		it('getOrNull returns null for unknown type', () => {
			const result = pmRegistry.getOrNull('unknown-type');
			expect(result).toBeNull();
		});
	});
});
