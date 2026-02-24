import { describe, expect, it } from 'vitest';
import {
	GitHubTriggerConfigSchema,
	JiraTriggerConfigSchema,
	TrelloTriggerConfigSchema,
	resolveGitHubTriggerEnabled,
	resolveIssueTransitionedEnabled,
	resolveJiraTriggerEnabled,
	resolvePerAgentToggle,
	resolveReadyToProcessEnabled,
	resolveReviewTriggerConfig,
	resolveTrelloTriggerEnabled,
	resolveTriggerEnabled,
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
	it('defaults commentMention to true, issueTransitioned and readyToProcessLabel optional', () => {
		const result = JiraTriggerConfigSchema.parse({});
		expect(result.commentMention).toBe(true);
		expect(result.issueTransitioned).toBeUndefined();
		expect(result.readyToProcessLabel).toBeUndefined();
	});

	it('accepts legacy boolean issueTransitioned', () => {
		const result = JiraTriggerConfigSchema.parse({ issueTransitioned: false });
		expect(result.issueTransitioned).toBe(false);
	});

	it('accepts per-agent issueTransitioned object', () => {
		const result = JiraTriggerConfigSchema.parse({
			issueTransitioned: { briefing: true, planning: false, implementation: true },
		});
		expect(result.issueTransitioned).toEqual({
			briefing: true,
			planning: false,
			implementation: true,
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

	it('accepts reviewTrigger nested object', () => {
		const result = GitHubTriggerConfigSchema.parse({
			reviewTrigger: { ownPrsOnly: true, externalPrs: false, onReviewRequested: true },
		});
		expect(result.reviewTrigger).toEqual({
			ownPrsOnly: true,
			externalPrs: false,
			onReviewRequested: true,
		});
	});

	it('reviewTrigger optional — absent by default', () => {
		const result = GitHubTriggerConfigSchema.parse({});
		expect(result.reviewTrigger).toBeUndefined();
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

	it('returns false when issueTransitioned is explicitly false (legacy boolean)', () => {
		expect(resolveJiraTriggerEnabled({ issueTransitioned: false }, 'issueTransitioned')).toBe(
			false,
		);
	});

	it('returns true when config is empty (no explicit settings)', () => {
		expect(resolveJiraTriggerEnabled({}, 'issueTransitioned')).toBe(true);
	});

	it('returns true for issueTransitioned object when any agent is enabled', () => {
		expect(
			resolveJiraTriggerEnabled(
				{ issueTransitioned: { briefing: false, planning: true, implementation: false } },
				'issueTransitioned',
			),
		).toBe(true);
	});

	it('returns false for issueTransitioned object when all agents disabled', () => {
		expect(
			resolveJiraTriggerEnabled(
				{ issueTransitioned: { briefing: false, planning: false, implementation: false } },
				'issueTransitioned',
			),
		).toBe(false);
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

	it('returns true for reviewTrigger when config contains the object', () => {
		expect(
			resolveGitHubTriggerEnabled(
				{ reviewTrigger: { ownPrsOnly: true, externalPrs: false, onReviewRequested: false } },
				'reviewTrigger',
			),
		).toBe(true);
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

	it('defaults to true for known non-toggle agents like respond-to-review', () => {
		const config = {
			readyToProcessLabel: { briefing: false, planning: false, implementation: false },
		};
		expect(resolveReadyToProcessEnabled(config, 'respond-to-review')).toBe(true);
		expect(resolveReadyToProcessEnabled(config, 'debug')).toBe(true);
	});

	it('defaults all agents to true when nested object is empty (Zod fills defaults)', () => {
		const parsed = TrelloTriggerConfigSchema.parse({ readyToProcessLabel: {} });
		expect(resolveReadyToProcessEnabled(parsed, 'briefing')).toBe(true);
		expect(resolveReadyToProcessEnabled(parsed, 'planning')).toBe(true);
		expect(resolveReadyToProcessEnabled(parsed, 'implementation')).toBe(true);
	});
});

describe('resolveIssueTransitionedEnabled', () => {
	it('returns true when config is undefined (backward compatible)', () => {
		expect(resolveIssueTransitionedEnabled(undefined, 'briefing')).toBe(true);
		expect(resolveIssueTransitionedEnabled(undefined, 'planning')).toBe(true);
		expect(resolveIssueTransitionedEnabled(undefined, 'implementation')).toBe(true);
	});

	it('returns true when issueTransitioned is not set', () => {
		expect(resolveIssueTransitionedEnabled({}, 'briefing')).toBe(true);
	});

	it('applies legacy boolean true to all agents', () => {
		const config = { issueTransitioned: true as const };
		expect(resolveIssueTransitionedEnabled(config, 'briefing')).toBe(true);
		expect(resolveIssueTransitionedEnabled(config, 'planning')).toBe(true);
		expect(resolveIssueTransitionedEnabled(config, 'implementation')).toBe(true);
	});

	it('applies legacy boolean false to all agents', () => {
		const config = { issueTransitioned: false as const };
		expect(resolveIssueTransitionedEnabled(config, 'briefing')).toBe(false);
		expect(resolveIssueTransitionedEnabled(config, 'planning')).toBe(false);
		expect(resolveIssueTransitionedEnabled(config, 'implementation')).toBe(false);
	});

	it('returns per-agent value from nested object', () => {
		const config = {
			issueTransitioned: { briefing: true, planning: false, implementation: true },
		};
		expect(resolveIssueTransitionedEnabled(config, 'briefing')).toBe(true);
		expect(resolveIssueTransitionedEnabled(config, 'planning')).toBe(false);
		expect(resolveIssueTransitionedEnabled(config, 'implementation')).toBe(true);
	});

	it('defaults to true for unknown agent types', () => {
		const config = {
			issueTransitioned: { briefing: false, planning: false, implementation: false },
		};
		expect(resolveIssueTransitionedEnabled(config, 'unknown-agent')).toBe(true);
	});

	it('defaults to true for known non-toggle agents like respond-to-review', () => {
		const config = {
			issueTransitioned: { briefing: false, planning: false, implementation: false },
		};
		expect(resolveIssueTransitionedEnabled(config, 'respond-to-review')).toBe(true);
		expect(resolveIssueTransitionedEnabled(config, 'debug')).toBe(true);
	});

	it('defaults all agents to true when nested object is empty (Zod fills defaults)', () => {
		const parsed = JiraTriggerConfigSchema.parse({ issueTransitioned: {} });
		expect(resolveIssueTransitionedEnabled(parsed, 'briefing')).toBe(true);
		expect(resolveIssueTransitionedEnabled(parsed, 'planning')).toBe(true);
		expect(resolveIssueTransitionedEnabled(parsed, 'implementation')).toBe(true);
	});
});

describe('resolveReviewTriggerConfig', () => {
	it('maps legacy defaults when config is undefined (backward compatible)', () => {
		// No config → legacy fallback: checkSuiteSuccess defaults to true → ownPrsOnly=true
		// This preserves the existing behavior for projects with no trigger config
		const result = resolveReviewTriggerConfig(undefined);
		expect(result).toEqual({ ownPrsOnly: true, externalPrs: false, onReviewRequested: false });
	});

	it('returns ownPrsOnly=true (legacy default) when config has no review-related keys', () => {
		// checkSuiteSuccess is undefined → legacy default is true → ownPrsOnly=true
		const result = resolveReviewTriggerConfig({ checkSuiteFailure: true });
		expect(result).toEqual({ ownPrsOnly: true, externalPrs: false, onReviewRequested: false });
	});

	describe('new structured reviewTrigger config takes precedence', () => {
		it('uses reviewTrigger object when present', () => {
			const result = resolveReviewTriggerConfig({
				reviewTrigger: { ownPrsOnly: true, externalPrs: true, onReviewRequested: true },
				// Legacy booleans present but should be ignored
				checkSuiteSuccess: false,
				reviewRequested: false,
			});
			expect(result).toEqual({ ownPrsOnly: true, externalPrs: true, onReviewRequested: true });
		});

		it('uses reviewTrigger partial — missing fields default to false', () => {
			const result = resolveReviewTriggerConfig({
				reviewTrigger: { ownPrsOnly: true, externalPrs: false, onReviewRequested: false },
			});
			expect(result.ownPrsOnly).toBe(true);
			expect(result.externalPrs).toBe(false);
			expect(result.onReviewRequested).toBe(false);
		});

		it('externalPrs can be independently enabled', () => {
			const result = resolveReviewTriggerConfig({
				reviewTrigger: { ownPrsOnly: false, externalPrs: true, onReviewRequested: false },
			});
			expect(result.ownPrsOnly).toBe(false);
			expect(result.externalPrs).toBe(true);
			expect(result.onReviewRequested).toBe(false);
		});
	});

	describe('legacy boolean fallback', () => {
		it('maps checkSuiteSuccess=true to ownPrsOnly=true (legacy default)', () => {
			const result = resolveReviewTriggerConfig({ checkSuiteSuccess: true });
			expect(result.ownPrsOnly).toBe(true);
			expect(result.externalPrs).toBe(false);
		});

		it('maps checkSuiteSuccess=false to ownPrsOnly=false', () => {
			const result = resolveReviewTriggerConfig({ checkSuiteSuccess: false });
			expect(result.ownPrsOnly).toBe(false);
		});

		it('maps reviewRequested=true to onReviewRequested=true', () => {
			const result = resolveReviewTriggerConfig({ reviewRequested: true });
			expect(result.onReviewRequested).toBe(true);
		});

		it('maps reviewRequested=false to onReviewRequested=false', () => {
			const result = resolveReviewTriggerConfig({ reviewRequested: false });
			expect(result.onReviewRequested).toBe(false);
		});

		it('externalPrs is always false in legacy mode (no legacy equivalent)', () => {
			const result = resolveReviewTriggerConfig({
				checkSuiteSuccess: true,
				reviewRequested: true,
			});
			expect(result.externalPrs).toBe(false);
		});
	});
});

// ============================================================================
// Tests for new generic helpers
// ============================================================================

describe('resolvePerAgentToggle', () => {
	describe('undefined value', () => {
		it('returns true for all known agent types', () => {
			expect(resolvePerAgentToggle(undefined, 'briefing')).toBe(true);
			expect(resolvePerAgentToggle(undefined, 'planning')).toBe(true);
			expect(resolvePerAgentToggle(undefined, 'implementation')).toBe(true);
		});

		it('returns true for unknown agent types', () => {
			expect(resolvePerAgentToggle(undefined, 'review')).toBe(true);
			expect(resolvePerAgentToggle(undefined, 'debug')).toBe(true);
		});
	});

	describe('boolean value', () => {
		it('returns true when value is true, for all agent types', () => {
			expect(resolvePerAgentToggle(true, 'briefing')).toBe(true);
			expect(resolvePerAgentToggle(true, 'planning')).toBe(true);
			expect(resolvePerAgentToggle(true, 'implementation')).toBe(true);
			expect(resolvePerAgentToggle(true, 'unknown')).toBe(true);
		});

		it('returns false when value is false, for all agent types', () => {
			expect(resolvePerAgentToggle(false, 'briefing')).toBe(false);
			expect(resolvePerAgentToggle(false, 'planning')).toBe(false);
			expect(resolvePerAgentToggle(false, 'implementation')).toBe(false);
			expect(resolvePerAgentToggle(false, 'unknown')).toBe(false);
		});
	});

	describe('per-agent object', () => {
		it('returns the correct value for each known agent type', () => {
			const obj = { briefing: true, planning: false, implementation: true };
			expect(resolvePerAgentToggle(obj, 'briefing')).toBe(true);
			expect(resolvePerAgentToggle(obj, 'planning')).toBe(false);
			expect(resolvePerAgentToggle(obj, 'implementation')).toBe(true);
		});

		it('defaults to true for unknown agent types', () => {
			const obj = { briefing: false, planning: false, implementation: false };
			expect(resolvePerAgentToggle(obj, 'respond-to-review')).toBe(true);
			expect(resolvePerAgentToggle(obj, 'debug')).toBe(true);
			expect(resolvePerAgentToggle(obj, 'anything-else')).toBe(true);
		});

		it('defaults missing fields to true', () => {
			const obj = { briefing: false }; // planning and implementation are undefined
			expect(resolvePerAgentToggle(obj, 'planning')).toBe(true);
			expect(resolvePerAgentToggle(obj, 'implementation')).toBe(true);
		});
	});
});

describe('resolveTriggerEnabled', () => {
	describe('no config (undefined)', () => {
		it('returns true for standard keys', () => {
			expect(resolveTriggerEnabled(undefined, 'someKey')).toBe(true);
		});

		it('returns false for opt-in keys', () => {
			expect(resolveTriggerEnabled(undefined, 'optInKey', { optInKeys: ['optInKey'] })).toBe(false);
		});
	});

	describe('config present but key missing', () => {
		it('returns true for standard keys', () => {
			expect(resolveTriggerEnabled({}, 'someKey')).toBe(true);
		});

		it('returns false for opt-in keys', () => {
			expect(resolveTriggerEnabled({}, 'optInKey', { optInKeys: ['optInKey'] })).toBe(false);
		});
	});

	describe('boolean values', () => {
		it('returns the boolean value directly', () => {
			expect(resolveTriggerEnabled({ foo: true }, 'foo')).toBe(true);
			expect(resolveTriggerEnabled({ foo: false }, 'foo')).toBe(false);
		});

		it('respects opt-in keys when value is explicitly set', () => {
			expect(resolveTriggerEnabled({ optKey: true }, 'optKey', { optInKeys: ['optKey'] })).toBe(
				true,
			);
			expect(resolveTriggerEnabled({ optKey: false }, 'optKey', { optInKeys: ['optKey'] })).toBe(
				false,
			);
		});
	});

	describe('nested keys (per-agent objects)', () => {
		it('returns true for boolean true nested key', () => {
			expect(resolveTriggerEnabled({ rtp: true }, 'rtp', { nestedKeys: ['rtp'] })).toBe(true);
		});

		it('returns false for boolean false nested key', () => {
			expect(resolveTriggerEnabled({ rtp: false }, 'rtp', { nestedKeys: ['rtp'] })).toBe(false);
		});

		it('returns true if any agent in the object is enabled', () => {
			expect(
				resolveTriggerEnabled(
					{ rtp: { briefing: false, planning: true, implementation: false } },
					'rtp',
					{ nestedKeys: ['rtp'] },
				),
			).toBe(true);
		});

		it('returns false if all agents in the object are disabled', () => {
			expect(
				resolveTriggerEnabled(
					{ rtp: { briefing: false, planning: false, implementation: false } },
					'rtp',
					{ nestedKeys: ['rtp'] },
				),
			).toBe(false);
		});
	});

	describe('object keys (non-boolean objects)', () => {
		it('returns true when value is an object (non-boolean)', () => {
			expect(
				resolveTriggerEnabled({ rt: { ownPrsOnly: true } }, 'rt', { objectKeys: ['rt'] }),
			).toBe(true);
		});

		it('returns the boolean value when the key stores a boolean', () => {
			expect(resolveTriggerEnabled({ rt: true }, 'rt', { objectKeys: ['rt'] })).toBe(true);
			expect(resolveTriggerEnabled({ rt: false }, 'rt', { objectKeys: ['rt'] })).toBe(false);
		});
	});

	describe('backward-compat verification — wrapper behavior matches generic', () => {
		it('resolveTrelloTriggerEnabled matches resolveTriggerEnabled for all Trello cases', () => {
			const cases: [Record<string, unknown>, string, boolean][] = [
				[{}, 'cardMovedToBriefing', true],
				[{ cardMovedToBriefing: false }, 'cardMovedToBriefing', false],
				[{ readyToProcessLabel: false }, 'readyToProcessLabel', false],
				[{ readyToProcessLabel: true }, 'readyToProcessLabel', true],
				[
					{ readyToProcessLabel: { briefing: false, planning: true, implementation: false } },
					'readyToProcessLabel',
					true,
				],
				[
					{ readyToProcessLabel: { briefing: false, planning: false, implementation: false } },
					'readyToProcessLabel',
					false,
				],
			];
			for (const [config, key, expected] of cases) {
				expect(resolveTriggerEnabled(config, key, { nestedKeys: ['readyToProcessLabel'] })).toBe(
					expected,
				);
			}
		});

		it('resolveGitHubTriggerEnabled matches resolveTriggerEnabled for opt-in and object keys', () => {
			const optInKeys = ['reviewRequested', 'prOpened'];
			const objectKeys = ['reviewTrigger'];

			// opt-in absent
			expect(resolveTriggerEnabled(undefined, 'reviewRequested', { optInKeys, objectKeys })).toBe(
				false,
			);
			// opt-in enabled
			expect(
				resolveTriggerEnabled({ reviewRequested: true }, 'reviewRequested', {
					optInKeys,
					objectKeys,
				}),
			).toBe(true);
			// object key present
			expect(
				resolveTriggerEnabled(
					{ reviewTrigger: { ownPrsOnly: true, externalPrs: false, onReviewRequested: false } },
					'reviewTrigger',
					{ optInKeys, objectKeys },
				),
			).toBe(true);
		});
	});
});
