import { describe, expect, it } from 'vitest';
import {
	BRIEFING_SYSTEM_PROMPT,
	IMPLEMENTATION_SYSTEM_PROMPT,
	PLANNING_SYSTEM_PROMPT,
	getSystemPrompt,
} from '../../../src/agents/prompts/index.js';

describe('getSystemPrompt', () => {
	it('returns briefing prompt for briefing agent', () => {
		const prompt = getSystemPrompt('briefing');
		expect(prompt).toBe(BRIEFING_SYSTEM_PROMPT);
		expect(prompt).toContain('product manager');
		expect(prompt).toContain('DO NOT IMPLEMENT');
	});

	it('returns planning prompt for planning agent', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toBe(PLANNING_SYSTEM_PROMPT);
		expect(prompt).toContain('software architect');
		expect(prompt).toContain('implementation plan');
	});

	it('returns implementation prompt for implementation agent', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toBe(IMPLEMENTATION_SYSTEM_PROMPT);
		expect(prompt).toContain('software engineer');
		expect(prompt).toContain('TDD');
	});

	it('throws for unknown agent type', () => {
		expect(() => getSystemPrompt('unknown')).toThrow('Unknown agent type: unknown');
	});
});

describe('system prompts content', () => {
	it('briefing prompt includes key instructions', () => {
		expect(BRIEFING_SYSTEM_PROMPT).toContain('ReadTrelloCard');
		expect(BRIEFING_SYSTEM_PROMPT).toContain('UpdateTrelloCard');
		expect(BRIEFING_SYSTEM_PROMPT).toContain('PostTrelloComment');
		expect(BRIEFING_SYSTEM_PROMPT).toContain('First Draft Over Questions');
	});

	it('planning prompt includes key instructions', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('ReadTrelloCard');
		expect(PLANNING_SYSTEM_PROMPT).toContain('step-by-step');
	});

	it('implementation prompt includes git instructions', () => {
		expect(IMPLEMENTATION_SYSTEM_PROMPT).toContain('GitBranch');
		expect(IMPLEMENTATION_SYSTEM_PROMPT).toContain('GitCommit');
		expect(IMPLEMENTATION_SYSTEM_PROMPT).toContain('CreatePR');
		expect(IMPLEMENTATION_SYSTEM_PROMPT).toContain('conventional commits');
	});
});
