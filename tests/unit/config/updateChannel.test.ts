import { describe, expect, it } from 'vitest';

import {
	DEFAULT_UPDATE_CHANNEL,
	filterPostingGadgetNames,
	isPmPostingEnabled,
	isScmPostingEnabled,
	PM_POSTING_GADGETS,
	resolveUpdateChannel,
	SCM_POSTING_GADGETS,
	UPDATE_CHANNELS,
	type UpdateChannel,
	UpdateChannelSchema,
} from '../../../src/config/updateChannel.js';

describe.concurrent('config/updateChannel', () => {
	describe('UPDATE_CHANNELS', () => {
		it('lists the four channels', () => {
			expect(UPDATE_CHANNELS).toEqual(['none', 'scm-only', 'pm-only', 'both']);
		});
	});

	describe('DEFAULT_UPDATE_CHANNEL', () => {
		it("defaults to 'both' (post everywhere — historical behavior)", () => {
			expect(DEFAULT_UPDATE_CHANNEL).toBe('both');
		});

		it('is one of the known channels', () => {
			expect(UPDATE_CHANNELS).toContain(DEFAULT_UPDATE_CHANNEL);
		});
	});

	describe('UpdateChannelSchema', () => {
		it('accepts every known channel', () => {
			for (const channel of UPDATE_CHANNELS) {
				expect(UpdateChannelSchema.parse(channel)).toBe(channel);
			}
		});

		it('rejects unknown values', () => {
			expect(UpdateChannelSchema.safeParse('all').success).toBe(false);
			expect(UpdateChannelSchema.safeParse('').success).toBe(false);
			expect(UpdateChannelSchema.safeParse(undefined).success).toBe(false);
		});
	});

	describe('resolveUpdateChannel', () => {
		it('reads project.agentUpdateChannels[agentType]', () => {
			const project = {
				agentUpdateChannels: { implementation: 'pm-only' as UpdateChannel },
			};
			expect(resolveUpdateChannel(project, 'implementation')).toBe('pm-only');
		});

		it('resolves each agent type independently', () => {
			const project = {
				agentUpdateChannels: {
					implementation: 'scm-only' as UpdateChannel,
					review: 'none' as UpdateChannel,
				},
			};
			expect(resolveUpdateChannel(project, 'implementation')).toBe('scm-only');
			expect(resolveUpdateChannel(project, 'review')).toBe('none');
		});

		it("falls back to 'both' when the project has no map", () => {
			expect(resolveUpdateChannel({}, 'implementation')).toBe('both');
		});

		it("falls back to 'both' when the agent type has no entry", () => {
			const project = {
				agentUpdateChannels: { review: 'none' as UpdateChannel },
			};
			expect(resolveUpdateChannel(project, 'implementation')).toBe('both');
		});

		it("falls back to 'both' when the entry is undefined", () => {
			const project = {
				agentUpdateChannels: { implementation: undefined },
			};
			expect(resolveUpdateChannel(project, 'implementation')).toBe('both');
		});

		it('uses DEFAULT_UPDATE_CHANNEL as the fallback', () => {
			expect(resolveUpdateChannel({}, 'anything')).toBe(DEFAULT_UPDATE_CHANNEL);
		});
	});

	describe('posting matrix (isPmPostingEnabled / isScmPostingEnabled)', () => {
		const matrix: Array<{ channel: UpdateChannel; pm: boolean; scm: boolean }> = [
			{ channel: 'none', pm: false, scm: false },
			{ channel: 'pm-only', pm: true, scm: false },
			{ channel: 'scm-only', pm: false, scm: true },
			{ channel: 'both', pm: true, scm: true },
		];

		it('covers every channel in UPDATE_CHANNELS', () => {
			expect(matrix.map((row) => row.channel).sort()).toEqual([...UPDATE_CHANNELS].sort());
		});

		for (const { channel, pm, scm } of matrix) {
			it(`${channel} → PM:${pm ? '✅' : '❌'} SCM:${scm ? '✅' : '❌'}`, () => {
				expect(isPmPostingEnabled(channel)).toBe(pm);
				expect(isScmPostingEnabled(channel)).toBe(scm);
			});
		}
	});

	describe('posting gadget lists', () => {
		it('PM_POSTING_GADGETS is the work-item comment gadget', () => {
			expect(PM_POSTING_GADGETS).toEqual(['PostComment']);
		});

		it('SCM_POSTING_GADGETS are the PR comment / review gadgets', () => {
			expect(SCM_POSTING_GADGETS).toEqual([
				'PostPRComment',
				'UpdatePRComment',
				'CreatePRReview',
				'ReplyToReviewComment',
			]);
		});

		it('PM and SCM posting gadgets do not overlap', () => {
			const overlap = PM_POSTING_GADGETS.filter((name) =>
				(SCM_POSTING_GADGETS as readonly string[]).includes(name),
			);
			expect(overlap).toEqual([]);
		});
	});

	describe('filterPostingGadgetNames', () => {
		const ALL_POSTING = [...PM_POSTING_GADGETS, ...SCM_POSTING_GADGETS];

		it("'both' keeps every posting gadget", () => {
			expect(filterPostingGadgetNames(ALL_POSTING, 'both')).toEqual(ALL_POSTING);
		});

		it("'none' drops every posting gadget", () => {
			expect(filterPostingGadgetNames(ALL_POSTING, 'none')).toEqual([]);
		});

		it("'pm-only' keeps PM posting and drops SCM posting", () => {
			expect(filterPostingGadgetNames(ALL_POSTING, 'pm-only')).toEqual([...PM_POSTING_GADGETS]);
		});

		it("'scm-only' keeps SCM posting and drops PM posting", () => {
			expect(filterPostingGadgetNames(ALL_POSTING, 'scm-only')).toEqual([...SCM_POSTING_GADGETS]);
		});

		it('never drops action (non-posting) gadget names', () => {
			const actionGadgets = ['CreatePR', 'MoveWorkItem', 'UpdateWorkItem', 'ReadFile'];
			for (const channel of UPDATE_CHANNELS) {
				expect(filterPostingGadgetNames(actionGadgets, channel)).toEqual(actionGadgets);
			}
		});

		it('drops only the disabled posting names while preserving order around them', () => {
			const names = ['ReadFile', 'PostComment', 'CreatePR', 'PostPRComment', 'MoveWorkItem'];
			expect(filterPostingGadgetNames(names, 'pm-only')).toEqual([
				'ReadFile',
				'PostComment',
				'CreatePR',
				'MoveWorkItem',
			]);
			expect(filterPostingGadgetNames(names, 'scm-only')).toEqual([
				'ReadFile',
				'CreatePR',
				'PostPRComment',
				'MoveWorkItem',
			]);
			expect(filterPostingGadgetNames(names, 'none')).toEqual([
				'ReadFile',
				'CreatePR',
				'MoveWorkItem',
			]);
		});

		it('does not mutate the input array', () => {
			const names = ['PostComment', 'PostPRComment'];
			const snapshot = [...names];
			filterPostingGadgetNames(names, 'none');
			expect(names).toEqual(snapshot);
		});

		it('handles an empty list', () => {
			expect(filterPostingGadgetNames([], 'both')).toEqual([]);
			expect(filterPostingGadgetNames([], 'none')).toEqual([]);
		});
	});
});
