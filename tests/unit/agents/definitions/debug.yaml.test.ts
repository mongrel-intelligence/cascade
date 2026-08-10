import { afterEach, describe, expect, it } from 'vitest';
import {
	clearDefinitionCache,
	loadBuiltinDefinition,
} from '../../../../src/agents/definitions/loader.js';
import {
	buildTaskPromptContext,
	renderInlineTaskPrompt,
} from '../../../../src/agents/prompts/index.js';

describe('debug.yaml task prompt', () => {
	afterEach(() => {
		clearDefinitionCache();
	});

	function render(input: Record<string, unknown>): string {
		const definition = loadBuiltinDefinition('debug');
		return renderInlineTaskPrompt(definition.prompts.taskPrompt, buildTaskPromptContext(input));
	}

	it('describes a PM-driven run using the original work item ID', () => {
		const prompt = render({
			detectedAgentType: 'implementation',
			originalWorkItemId: 'MNG-1761',
		});

		expect(prompt).toContain('implementation agent');
		expect(prompt).toContain('work item MNG-1761');
		expect(prompt).not.toContain('undefined');
	});

	it('describes a PR-driven run using the PR number', () => {
		const prompt = render({
			detectedAgentType: 'review',
			prNumber: 1761,
		});

		expect(prompt).toContain('review agent');
		expect(prompt).toContain('PR #1761');
		expect(prompt).not.toContain('undefined');
	});

	it('omits source identifiers when neither is available', () => {
		const prompt = render({ detectedAgentType: 'debug' });

		expect(prompt).toContain('debug agent');
		expect(prompt).not.toContain('work item');
		expect(prompt).not.toContain('PR #');
		expect(prompt).not.toContain('undefined');
	});
});
