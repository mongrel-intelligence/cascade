import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock resolveKnownAgentTypes so validTypes is populated without DB
vi.mock('../../../../src/agents/definitions/index.js', () => ({
	resolveKnownAgentTypes: vi.fn().mockResolvedValue(['implementation']),
}));

import { getSystemPrompt, initPrompts } from '../../../../src/agents/prompts/index.js';

beforeAll(async () => {
	await initPrompts();
});

/**
 * The implementation.eta template forks on `it.pmPostingEnabled` — when the
 * project's update channel disables PM posting (scm-only / none) the agent must
 * NOT be instructed to post a summary comment on the work item. Otherwise a
 * native-tool agent reads the instruction and calls `cascade-tools pm
 * post-comment` via bash even though the PostComment tool manifest was filtered
 * out of availableTools. Both the Phase-4 task step (step 10) and the dedicated
 * "Post Summary Comment" completion section must be suppressed together.
 */
describe('implementation prompt — PM-posting suppression fork', () => {
	describe('default render (pmPostingEnabled absent/true)', () => {
		for (const context of [undefined, { pmPostingEnabled: true }]) {
			const label = context === undefined ? 'absent' : 'true';
			it(`keeps the summary-comment instructions when the flag is ${label}`, () => {
				const prompt = getSystemPrompt('implementation', context);
				// Step 10 in the Phase-4 task list
				expect(prompt).toContain('**Post summary comment**');
				// The dedicated "Post Summary Comment" completion section
				expect(prompt).toContain('### 2. Post Summary Comment');
				expect(prompt).toContain('Use `PostComment` to post a summary');
			});
		}
	});

	describe('pm-posting-disabled render (pmPostingEnabled false)', () => {
		it('drops the Phase-4 summary-comment step (step 10)', () => {
			const prompt = getSystemPrompt('implementation', { pmPostingEnabled: false });
			expect(prompt).not.toContain('**Post summary comment**');
		});

		it('drops the dedicated Post Summary Comment completion section', () => {
			const prompt = getSystemPrompt('implementation', { pmPostingEnabled: false });
			expect(prompt).not.toContain('### 2. Post Summary Comment');
			expect(prompt).not.toContain('Use `PostComment` to post a summary');
		});

		it('still keeps the non-PM completion steps (PR creation, acceptance criteria)', () => {
			const prompt = getSystemPrompt('implementation', { pmPostingEnabled: false });
			expect(prompt).toContain('**Create a PR**');
			expect(prompt).toContain('**Mark acceptance criteria complete**');
		});
	});
});
