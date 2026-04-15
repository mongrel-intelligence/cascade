import { describe, expect, it } from 'vitest';
import {
	getCostFieldId,
	getJiraConfig,
	getLinearConfig,
	getPMConfig,
	getTrelloConfig,
} from '../../../src/pm/config.js';
import type { ProjectConfig } from '../../../src/types/index.js';

// Minimal required fields for a ProjectConfig fixture
const BASE_PROJECT: Pick<
	ProjectConfig,
	| 'id'
	| 'orgId'
	| 'name'
	| 'baseBranch'
	| 'branchPrefix'
	| 'model'
	| 'maxIterations'
	| 'watchdogTimeoutMs'
	| 'progressModel'
	| 'progressIntervalMinutes'
	| 'workItemBudgetUsd'
	| 'runLinksEnabled'
> = {
	id: 'test-project',
	orgId: 'test-org',
	name: 'Test Project',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	model: 'openrouter:google/gemini-3-flash-preview',
	maxIterations: 50,
	watchdogTimeoutMs: 1800000,
	progressModel: 'openrouter:google/gemini-2.5-flash-lite',
	progressIntervalMinutes: 5,
	workItemBudgetUsd: 5,
	runLinksEnabled: false,
};

const TRELLO_CONFIG = {
	boardId: 'b1',
	lists: { todo: 'list1', inProgress: 'list2' },
	labels: { auto: 'label1' },
} as const;

const TRELLO_CONFIG_WITH_COST = {
	...TRELLO_CONFIG,
	customFields: { cost: 'trello-cost-field' },
} as const;

const JIRA_CONFIG = {
	projectKey: 'TEST',
	baseUrl: 'https://test.atlassian.net',
	statuses: { todo: 'To Do', inProgress: 'In Progress' },
} as const;

const JIRA_CONFIG_WITH_COST = {
	...JIRA_CONFIG,
	customFields: { cost: 'jira-cost-field' },
} as const;

describe('pm/config', () => {
	describe('getTrelloConfig', () => {
		it('returns trello config when pm.type is trello', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				trello: TRELLO_CONFIG,
			};

			const result = getTrelloConfig(project);

			expect(result).toEqual(TRELLO_CONFIG);
		});

		it('returns trello config when pm.type is undefined (legacy fallback)', () => {
			// Cast to simulate a legacy project that has no pm.type set
			const project = {
				...BASE_PROJECT,
				pm: {} as ProjectConfig['pm'],
				trello: TRELLO_CONFIG,
			} as ProjectConfig;

			const result = getTrelloConfig(project);

			expect(result).toEqual(TRELLO_CONFIG);
		});

		it('returns undefined when pm.type is jira', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
				jira: JIRA_CONFIG,
			};

			const result = getTrelloConfig(project);

			expect(result).toBeUndefined();
		});

		it('returns undefined when pm.type is trello but no trello config exists', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
			};

			const result = getTrelloConfig(project);

			expect(result).toBeUndefined();
		});
	});

	describe('getJiraConfig', () => {
		it('returns jira config when pm.type is jira', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
				jira: JIRA_CONFIG,
			};

			const result = getJiraConfig(project);

			expect(result).toEqual(JIRA_CONFIG);
		});

		it('returns jira config when pm.type is undefined (legacy fallback)', () => {
			// Cast to simulate a legacy project that has no pm.type set
			const project = {
				...BASE_PROJECT,
				pm: {} as ProjectConfig['pm'],
				jira: JIRA_CONFIG,
			} as ProjectConfig;

			const result = getJiraConfig(project);

			expect(result).toEqual(JIRA_CONFIG);
		});

		it('returns undefined when pm.type is trello', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				trello: TRELLO_CONFIG,
			};

			const result = getJiraConfig(project);

			expect(result).toBeUndefined();
		});

		it('returns undefined when pm.type is jira but no jira config exists', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
			};

			const result = getJiraConfig(project);

			expect(result).toBeUndefined();
		});
	});

	describe('getCostFieldId', () => {
		it('returns trello cost field for a trello project', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				trello: TRELLO_CONFIG_WITH_COST,
			};

			const result = getCostFieldId(project);

			expect(result).toBe('trello-cost-field');
		});

		it('returns jira cost field for a jira project', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
				jira: JIRA_CONFIG_WITH_COST,
			};

			const result = getCostFieldId(project);

			expect(result).toBe('jira-cost-field');
		});

		it('returns undefined when no customFields configured (trello)', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				trello: TRELLO_CONFIG,
			};

			const result = getCostFieldId(project);

			expect(result).toBeUndefined();
		});

		it('returns undefined when no customFields configured (jira)', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
				jira: JIRA_CONFIG,
			};

			const result = getCostFieldId(project);

			expect(result).toBeUndefined();
		});

		it('respects pm.type to select trello cost field over jira when pm.type is trello', () => {
			// Project has both trello and jira configs, but pm.type=trello
			const project = {
				...BASE_PROJECT,
				pm: { type: 'trello' } as ProjectConfig['pm'],
				trello: TRELLO_CONFIG_WITH_COST,
				jira: JIRA_CONFIG_WITH_COST,
			} as ProjectConfig;

			const result = getCostFieldId(project);

			expect(result).toBe('trello-cost-field');
		});

		it('respects pm.type to select jira cost field over trello when pm.type is jira', () => {
			// Project has both trello and jira configs, but pm.type=jira
			const project = {
				...BASE_PROJECT,
				pm: { type: 'jira' } as ProjectConfig['pm'],
				trello: TRELLO_CONFIG_WITH_COST,
				jira: JIRA_CONFIG_WITH_COST,
			} as ProjectConfig;

			const result = getCostFieldId(project);

			expect(result).toBe('jira-cost-field');
		});

		it('uses pmConfig.customFields.cost when pmConfig is available (generic path)', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				pmConfig: { boardId: 'b1', customFields: { cost: 'generic-cost-field' } },
			};

			const result = getCostFieldId(project);

			expect(result).toBe('generic-cost-field');
		});
	});

	describe('getPMConfig', () => {
		it('returns pmConfig when set (generic field takes priority)', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				pmConfig: { boardId: 'b1', lists: {}, labels: {} },
				trello: TRELLO_CONFIG,
			};

			const result = getPMConfig(project);

			expect(result).toEqual({ boardId: 'b1', lists: {}, labels: {} });
		});

		it('falls back to trello field when pmConfig not set', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
				trello: TRELLO_CONFIG,
			};

			const result = getPMConfig(project);

			expect(result).toEqual(TRELLO_CONFIG);
		});

		it('falls back to jira field when pmConfig not set and pm.type is jira', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'jira' },
				jira: JIRA_CONFIG,
			};

			const result = getPMConfig(project);

			expect(result).toEqual(JIRA_CONFIG);
		});

		it('falls back to linear field when pmConfig not set and pm.type is linear', () => {
			const LINEAR_CONFIG = {
				teamId: 'team1',
				statuses: { todo: 'Todo', inProgress: 'In Progress' },
			} as const;

			const project = {
				...BASE_PROJECT,
				pm: { type: 'linear' } as ProjectConfig['pm'],
				linear: LINEAR_CONFIG,
			} as ProjectConfig;

			const result = getPMConfig(project);

			expect(result).toEqual(LINEAR_CONFIG);
		});

		it('returns undefined when no PM config available', () => {
			const project: ProjectConfig = {
				...BASE_PROJECT,
				pm: { type: 'trello' },
			};

			const result = getPMConfig(project);

			expect(result).toBeUndefined();
		});

		it('returns pmConfig over per-provider field when pmConfig is set', () => {
			// pmConfig should take priority over per-provider field
			const project = {
				...BASE_PROJECT,
				pm: { type: 'trello' } as ProjectConfig['pm'],
				pmConfig: { boardId: 'generic-board', customData: true },
				trello: TRELLO_CONFIG,
			} as ProjectConfig;

			const result = getPMConfig(project);

			expect(result).toEqual({ boardId: 'generic-board', customData: true });
		});
	});
});
