import { describe, expect, it } from 'vitest';
import {
	GitHubTriggerConfigSchema,
	JiraTriggerConfigSchema,
	TrelloTriggerConfigSchema,
	resolveGitHubTriggerEnabled,
	resolveJiraTriggerEnabled,
	resolveReadyToProcessEnabled,
	resolveTrelloTriggerEnabled,
} from '../../../src/config/triggerConfig.js';

describe('TrelloTriggerConfigSchema', () => {
	it('defaults boolean fields to true', () => {
		const result = TrelloTriggerConfigSchema.parse({});
		expect(result).toEqual({
			cardMovedToBriefing: true,
			cardMovedToPlanning: true,
			cardMovedToTodo: true,
			// readyToProcessLabel is optional — not present in default parse
			commentMention: true,
		});
		expect(result.readyToProcessLabel).toBeUndefined();
	});

	it('accepts explicit false values', () => {
		const result = TrelloTriggerConfigSchema.parse({
			cardMovedToPlanning: false,
			readyToProcessLabel: false,
		});
		expect(result.cardMovedToPlanning).toBe(false);
		expect(result.readyToProcessLabel).toBe(false);
		expect(result.cardMovedToBriefing).toBe(true); // default still true
	});

	it('accepts per-agent readyToProcessLabel object', () => {
		const result = TrelloTriggerConfigSchema.parse({
			readyToProcessLabel: { briefing: true, planning: false, implementation: true },
		});
		expect(result.readyToProcessLabel).toEqual({
			briefing: true,
			planning: false,
			implementation: true,
		});
	});
});

describe('JiraTriggerConfigSchema', () => {
	it('defaults boolean fields to true, readyToProcessLabel optional', () => {
		const result = JiraTriggerConfigSchema.parse({});
		expect(result).toEqual({
			issueTransitioned: true,
			commentMention: true,
		});
		expect(result.readyToProcessLabel).toBeUndefined();
	});
});

describe('GitHubTriggerConfigSchema', () => {
	it('defaults existing triggers to true', () => {
		const result = GitHubTriggerConfigSchema.parse({});
		expect(result.checkSuiteSuccess).toBe(true);
		expect(result.checkSuiteFailure).toBe(true);
		expect(result.prReviewSubmitted).toBe(true);
		expect(result.prCommentMention).toBe(true);
		expect(result.prReadyToMerge).toBe(true);
		expect(result.prMerged).toBe(true);
	});

	it('defaults new opt-in triggers to false', () => {
		const result = GitHubTriggerConfigSchema.parse({});
		expect(result.reviewRequested).toBe(false);
		expect(result.prOpened).toBe(false);
	});
});

describe('resolveTrelloTriggerEnabled', () => {
	it('returns true when config is undefined (backward compatible)', () => {
		expect(resolveTrelloTriggerEnabled(undefined, 'cardMovedToBriefing')).toBe(true);
		expect(resolveTrelloTriggerEnabled(undefined, 'readyToProcessLabel')).toBe(true);
		expect(resolveTrelloTriggerEnabled(undefined, 'commentMention')).toBe(true);
	});

	it('returns true when key is not present in config', () => {
		expect(resolveTrelloTriggerEnabled({}, 'cardMovedToBriefing')).toBe(true);
	});

	it('returns false when key is explicitly disabled', () => {
		expect(resolveTrelloTriggerEnabled({ cardMovedToBriefing: false }, 'cardMovedToBriefing')).toBe(
			false,
		);
	});

	it('returns true when key is explicitly enabled', () => {
		expect(resolveTrelloTriggerEnabled({ cardMovedToPlanning: true }, 'cardMovedToPlanning')).toBe(
			true,
		);
	});

	it('returns false for readyToProcessLabel when boolean false', () => {
		expect(resolveTrelloTriggerEnabled({ readyToProcessLabel: false }, 'readyToProcessLabel')).toBe(
			false,
		);
	});

	it('returns true for readyToProcessLabel when any agent is enabled in object form', () => {
		expect(
			resolveTrelloTriggerEnabled(
				{ readyToProcessLabel: { briefing: false, planning: true, implementation: false } },
				'readyToProcessLabel',
			),
		).toBe(true);
	});

	it('returns false for readyToProcessLabel when all agents disabled in object form', () => {
		expect(
			resolveTrelloTriggerEnabled(
				{ readyToProcessLabel: { briefing: false, planning: false, implementation: false } },
				'readyToProcessLabel',
			),
		).toBe(false);
	});
});

describe('resolveJiraTriggerEnabled', () => {
	it('returns true when config is undefined (backward compatible)', () => {
		expect(resolveJiraTriggerEnabled(undefined, 'issueTransitioned')).toBe(true);
		expect(resolveJiraTriggerEnabled(undefined, 'readyToProcessLabel')).toBe(true);
		expect(resolveJiraTriggerEnabled(undefined, 'commentMention')).toBe(true);
	});

	it('returns false when key is explicitly disabled', () => {
		expect(resolveJiraTriggerEnabled({ issueTransitioned: false }, 'issueTransitioned')).toBe(
			false,
		);
	});

	it('returns true when config is empty (no explicit settings)', () => {
		expect(resolveJiraTriggerEnabled({}, 'issueTransitioned')).toBe(true);
	});
});

describe('resolveGitHubTriggerEnabled', () => {
	it('returns true for existing triggers when config is undefined', () => {
		expect(resolveGitHubTriggerEnabled(undefined, 'checkSuiteSuccess')).toBe(true);
		expect(resolveGitHubTriggerEnabled(undefined, 'checkSuiteFailure')).toBe(true);
		expect(resolveGitHubTriggerEnabled(undefined, 'prReviewSubmitted')).toBe(true);
		expect(resolveGitHubTriggerEnabled(undefined, 'prCommentMention')).toBe(true);
		expect(resolveGitHubTriggerEnabled(undefined, 'prReadyToMerge')).toBe(true);
		expect(resolveGitHubTriggerEnabled(undefined, 'prMerged')).toBe(true);
	});

	it('returns false for opt-in triggers when config is undefined', () => {
		expect(resolveGitHubTriggerEnabled(undefined, 'reviewRequested')).toBe(false);
		expect(resolveGitHubTriggerEnabled(undefined, 'prOpened')).toBe(false);
	});

	it('returns false for opt-in triggers when config is empty', () => {
		expect(resolveGitHubTriggerEnabled({}, 'reviewRequested')).toBe(false);
		expect(resolveGitHubTriggerEnabled({}, 'prOpened')).toBe(false);
	});

	it('returns true for opt-in triggers when explicitly enabled', () => {
		expect(resolveGitHubTriggerEnabled({ reviewRequested: true }, 'reviewRequested')).toBe(true);
		expect(resolveGitHubTriggerEnabled({ prOpened: true }, 'prOpened')).toBe(true);
	});

	it('returns false when existing trigger is explicitly disabled', () => {
		expect(resolveGitHubTriggerEnabled({ checkSuiteSuccess: false }, 'checkSuiteSuccess')).toBe(
			false,
		);
	});
});

describe('resolveReadyToProcessEnabled', () => {
	it('returns true when config is undefined (backward compatible)', () => {
		expect(resolveReadyToProcessEnabled(undefined, 'briefing')).toBe(true);
		expect(resolveReadyToProcessEnabled(undefined, 'planning')).toBe(true);
		expect(resolveReadyToProcessEnabled(undefined, 'implementation')).toBe(true);
	});

	it('returns true when readyToProcessLabel is not set', () => {
		expect(resolveReadyToProcessEnabled({}, 'briefing')).toBe(true);
	});

	it('applies legacy boolean true to all agents', () => {
		const config = { readyToProcessLabel: true as const };
		expect(resolveReadyToProcessEnabled(config, 'briefing')).toBe(true);
		expect(resolveReadyToProcessEnabled(config, 'planning')).toBe(true);
		expect(resolveReadyToProcessEnabled(config, 'implementation')).toBe(true);
	});

	it('applies legacy boolean false to all agents', () => {
		const config = { readyToProcessLabel: false as const };
		expect(resolveReadyToProcessEnabled(config, 'briefing')).toBe(false);
		expect(resolveReadyToProcessEnabled(config, 'planning')).toBe(false);
		expect(resolveReadyToProcessEnabled(config, 'implementation')).toBe(false);
	});

	it('returns per-agent value from nested object', () => {
		const config = {
			readyToProcessLabel: { briefing: true, planning: false, implementation: true },
		};
		expect(resolveReadyToProcessEnabled(config, 'briefing')).toBe(true);
		expect(resolveReadyToProcessEnabled(config, 'planning')).toBe(false);
		expect(resolveReadyToProcessEnabled(config, 'implementation')).toBe(true);
	});

	it('defaults to true for unknown agent types', () => {
		const config = {
			readyToProcessLabel: { briefing: false, planning: false, implementation: false },
		};
		expect(resolveReadyToProcessEnabled(config, 'unknown-agent')).toBe(true);
	});
});
