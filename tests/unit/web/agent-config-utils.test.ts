import { describe, expect, it } from 'vitest';
import type { ResolvedTrigger } from '../../../src/api/routers/_shared/triggerTypes.js';
import {
	countActiveTriggers,
	engineHasCredentials,
} from '../../../web/src/components/projects/agent-config-utils.js';

// ============================================================================
// engineHasCredentials
// ============================================================================

describe('engineHasCredentials', () => {
	it('returns true for unknown engines (conservative assumption)', () => {
		const keys = new Set<string>();
		expect(engineHasCredentials('unknown-engine', keys)).toBe(true);
	});

	it('returns false for codex when no credential keys are configured', () => {
		const keys = new Set<string>();
		expect(engineHasCredentials('codex', keys)).toBe(false);
	});

	it('returns true for codex when OPENAI_API_KEY is configured', () => {
		const keys = new Set(['OPENAI_API_KEY']);
		expect(engineHasCredentials('codex', keys)).toBe(true);
	});

	it('returns true for codex when CODEX_AUTH_JSON is configured', () => {
		const keys = new Set(['CODEX_AUTH_JSON']);
		expect(engineHasCredentials('codex', keys)).toBe(true);
	});

	it('returns false for claude-code when no credential keys are configured', () => {
		const keys = new Set<string>();
		expect(engineHasCredentials('claude-code', keys)).toBe(false);
	});

	it('returns true for claude-code when ANTHROPIC_API_KEY is configured', () => {
		const keys = new Set(['ANTHROPIC_API_KEY']);
		expect(engineHasCredentials('claude-code', keys)).toBe(true);
	});

	it('returns true for claude-code when CLAUDE_CODE_OAUTH_TOKEN is configured', () => {
		const keys = new Set(['CLAUDE_CODE_OAUTH_TOKEN']);
		expect(engineHasCredentials('claude-code', keys)).toBe(true);
	});

	it('returns false for opencode when no credential keys are configured', () => {
		const keys = new Set<string>();
		expect(engineHasCredentials('opencode', keys)).toBe(false);
	});

	it('returns true for opencode when OPENAI_API_KEY is configured', () => {
		const keys = new Set(['OPENAI_API_KEY']);
		expect(engineHasCredentials('opencode', keys)).toBe(true);
	});

	it('returns true for opencode when OPENROUTER_API_KEY is configured', () => {
		const keys = new Set(['OPENROUTER_API_KEY']);
		expect(engineHasCredentials('opencode', keys)).toBe(true);
	});

	it('returns false for llmist when no credential keys are configured', () => {
		const keys = new Set<string>();
		expect(engineHasCredentials('llmist', keys)).toBe(false);
	});

	it('returns true for llmist when OPENROUTER_API_KEY is configured', () => {
		const keys = new Set(['OPENROUTER_API_KEY']);
		expect(engineHasCredentials('llmist', keys)).toBe(true);
	});

	it('ignores unrelated keys', () => {
		const keys = new Set(['SOME_OTHER_KEY', 'UNRELATED_KEY']);
		expect(engineHasCredentials('claude-code', keys)).toBe(false);
	});
});

// ============================================================================
// countActiveTriggers
// ============================================================================

describe('countActiveTriggers', () => {
	const integrations = { pm: 'trello', scm: 'github' };

	function makeTrigger(event: string, enabled: boolean, providers?: string[]): ResolvedTrigger {
		return {
			event,
			enabled,
			providers: providers ?? [],
			label: event,
			parameters: [],
			parameterValues: {},
		} as ResolvedTrigger;
	}

	it('returns 0 when there are no triggers', () => {
		expect(countActiveTriggers([], integrations)).toBe(0);
	});

	it('counts only enabled triggers', () => {
		const triggers = [
			makeTrigger('pm:card-created', true),
			makeTrigger('pm:card-moved', false),
			makeTrigger('scm:pr-opened', true),
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(2);
	});

	it('counts triggers without provider restrictions normally', () => {
		const triggers = [
			makeTrigger('internal:run-complete', true),
			makeTrigger('internal:task-failed', true),
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(2);
	});

	it('filters out enabled triggers whose provider does not match active integration', () => {
		const triggers = [
			// This trigger is enabled but requires 'jira' — active pm is 'trello'
			makeTrigger('pm:issue-created', true, ['jira']),
			// This trigger requires 'trello' — active pm is 'trello'
			makeTrigger('pm:card-created', true, ['trello']),
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(1);
	});

	it('includes enabled triggers whose provider matches active integration', () => {
		const triggers = [
			makeTrigger('scm:pr-opened', true, ['github']),
			makeTrigger('scm:pr-merged', true, ['github']),
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(2);
	});

	it('returns 0 for all disabled triggers even if provider matches', () => {
		const triggers = [
			makeTrigger('pm:card-created', false, ['trello']),
			makeTrigger('scm:pr-opened', false, ['github']),
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(0);
	});

	it('handles null integrations gracefully', () => {
		const noIntegrations = { pm: null, scm: null };
		const triggers = [
			// provider restriction — active integration is null, so no match
			makeTrigger('pm:card-created', true, ['trello']),
			// no provider restriction — always included
			makeTrigger('internal:run-complete', true),
		];
		expect(countActiveTriggers(triggers, noIntegrations)).toBe(1);
	});

	it('counts mixed enabled/disabled triggers with provider filtering', () => {
		const triggers = [
			makeTrigger('pm:card-created', true, ['trello']), // enabled, provider matches
			makeTrigger('pm:card-moved', false, ['trello']), // disabled, skipped
			makeTrigger('pm:issue-created', true, ['jira']), // enabled, wrong provider
			makeTrigger('internal:run-complete', true), // enabled, no restriction
		];
		expect(countActiveTriggers(triggers, integrations)).toBe(2);
	});
});
