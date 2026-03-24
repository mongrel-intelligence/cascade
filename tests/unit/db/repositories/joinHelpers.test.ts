import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/schema/index.js', () => ({
	agentRuns: {
		id: 'id',
		projectId: 'project_id',
		workItemId: 'work_item_id',
		prNumber: 'pr_number',
	},
	prWorkItems: {
		id: 'id',
		projectId: 'project_id',
		workItemId: 'work_item_id',
		prNumber: 'pr_number',
	},
}));

// Mock drizzle-orm operators to return testable values
vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ type: 'and', conditions: args }),
	eq: (a: unknown, b: unknown) => ({ type: 'eq', left: a, right: b }),
	or: (...args: unknown[]) => ({ type: 'or', conditions: args }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		type: 'sql',
		strings,
		values,
	}),
}));

import { buildAgentRunWorkItemJoin } from '../../../../src/db/repositories/joinHelpers.js';

describe('joinHelpers', () => {
	describe('buildAgentRunWorkItemJoin', () => {
		it('returns a defined value (not undefined/null)', () => {
			const result = buildAgentRunWorkItemJoin();
			expect(result).toBeDefined();
			expect(result).not.toBeNull();
		});

		it('returns an OR condition', () => {
			const result = buildAgentRunWorkItemJoin() as { type: string; conditions: unknown[] };
			expect(result.type).toBe('or');
		});

		it('returns two branches in the OR condition', () => {
			const result = buildAgentRunWorkItemJoin() as { type: string; conditions: unknown[] };
			expect(result.conditions).toHaveLength(2);
		});

		it('first branch is an AND condition (projectId + prNumber match)', () => {
			const result = buildAgentRunWorkItemJoin() as { type: string; conditions: unknown[] };
			const branch1 = result.conditions[0] as { type: string; conditions: unknown[] };
			expect(branch1.type).toBe('and');
			expect(branch1.conditions).toHaveLength(2);
		});

		it('second branch is an AND condition (projectId + workItemId match with isNull guard)', () => {
			const result = buildAgentRunWorkItemJoin() as { type: string; conditions: unknown[] };
			const branch2 = result.conditions[1] as { type: string; conditions: unknown[] };
			expect(branch2.type).toBe('and');
			// 3 conditions: projectId match, workItemId = workItemId, prNumber IS NULL
			expect(branch2.conditions).toHaveLength(3);
		});
	});
});
