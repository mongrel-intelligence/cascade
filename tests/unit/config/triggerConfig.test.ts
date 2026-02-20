import { describe, expect, it } from 'vitest';
import {
	GitHubTriggerConfigSchema,
	JiraTriggerConfigSchema,
	TrelloTriggerConfigSchema,
	resolveGitHubTriggerEnabled,
	resolveJiraTriggerEnabled,
	resolveTrelloTriggerEnabled,
} from '../../../src/config/triggerConfig.js';

describe('TrelloTriggerConfigSchema', () => {
	it('defaults all fields to true', () => {
		const result = TrelloTriggerConfigSchema.parse({});
		expect(result).toEqual({
			cardMovedToBriefing: true,
			cardMovedToPlanning: true,
			cardMovedToTodo: true,
			readyToProcessLabel: true,
			commentMention: true,
		});
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
});

describe('JiraTriggerConfigSchema', () => {
	it('defaults all fields to true', () => {
		const result = JiraTriggerConfigSchema.parse({});
		expect(result).toEqual({
			issueTransitioned: true,
			readyToProcessLabel: true,
			commentMention: true,
		});
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
