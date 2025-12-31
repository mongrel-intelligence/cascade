import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from '../../../src/agents/prompts/index.js';

describe('getSystemPrompt', () => {
	it('returns briefing prompt for briefing agent', () => {
		const prompt = getSystemPrompt('briefing');
		expect(prompt).toContain('product manager');
		expect(prompt).toContain('DO NOT IMPLEMENT');
	});

	it('returns planning prompt for planning agent', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('software architect');
		expect(prompt).toContain('implementation plan');
	});

	it('returns implementation prompt for implementation agent', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('software engineer');
		expect(prompt).toContain('TDD');
	});

	it('throws for unknown agent type', () => {
		expect(() => getSystemPrompt('unknown')).toThrow('Unknown agent type: unknown');
	});

	it('renders context variables in briefing prompt', () => {
		const prompt = getSystemPrompt('briefing', {
			storiesListId: 'stories-123',
			processedLabelId: 'label-456',
		});
		expect(prompt).toContain('STORIES_LIST_ID: stories-123');
		expect(prompt).toContain('PROCESSED_LABEL_ID: label-456');
	});

	it('uses default values when context is not provided', () => {
		const prompt = getSystemPrompt('briefing');
		expect(prompt).toContain('STORIES_LIST_ID: NOT_CONFIGURED');
		expect(prompt).toContain('PROCESSED_LABEL_ID: NOT_CONFIGURED');
	});
});

describe('system prompts content', () => {
	it('briefing prompt includes key instructions', () => {
		const prompt = getSystemPrompt('briefing');
		expect(prompt).toContain('ReadTrelloCard');
		expect(prompt).toContain('CreateTrelloCard');
		expect(prompt).toContain('INVEST');
	});

	it('planning prompt includes key instructions', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('ReadTrelloCard');
		expect(prompt).toContain('step-by-step');
	});

	it('implementation prompt includes git instructions', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('Tmux');
		expect(prompt).toContain('conventional commits');
	});
});
