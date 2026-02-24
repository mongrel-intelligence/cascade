import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	resolveTrelloBotMemberId: vi.fn(),
}));

import { resolveTrelloBotMemberId } from '../../../src/router/acknowledgments.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import {
	isAgentLogAttachmentUploaded,
	isAgentLogFilename,
	isCardInTriggerList,
	isReadyToProcessLabelAdded,
	isSelfAuthoredTrelloComment,
} from '../../../src/router/trello.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
	trello: {
		boardId: 'board1',
		lists: {
			briefing: 'list-briefing',
			planning: 'list-planning',
			todo: 'list-todo',
			debug: 'list-debug',
		},
		labels: { readyToProcess: 'label-ready' },
	},
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isAgentLogFilename', () => {
	it('matches valid agent log filenames', () => {
		expect(isAgentLogFilename('implementation-2026-01-02T16-30-24-339Z.zip')).toBe(true);
		expect(isAgentLogFilename('briefing-timeout-2026-01-02T12-34-56-789Z.zip')).toBe(true);
	});

	it('matches multi-hyphen agent names (e.g. respond-to-review)', () => {
		expect(isAgentLogFilename('respond-to-review-2026-01-02T16-30-24-339Z.zip')).toBe(true);
		expect(isAgentLogFilename('respond-to-pr-comment-2026-01-02T16-30-24-339Z.zip')).toBe(true);
	});

	it('does not match non-zip filenames', () => {
		expect(isAgentLogFilename('screenshot.png')).toBe(false);
	});

	it('does not match filenames without a timestamp', () => {
		expect(isAgentLogFilename('implementation.zip')).toBe(false);
	});

	it('matches debug-prefixed filenames (caller filters separately)', () => {
		expect(isAgentLogFilename('debug-2026-01-02T16-30-24-339Z.zip')).toBe(true);
	});
});

describe('isCardInTriggerList', () => {
	it('returns true when card moved to trigger list', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-todo' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false when card moved to non-trigger list', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-other' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns true when card created in trigger list', () => {
		const result = isCardInTriggerList(
			'createCard',
			{ list: { id: 'list-briefing' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false when project has no trello config', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-todo' } },
			{
				...mockProject,
				trello: undefined,
			},
		);
		expect(result).toBe(false);
	});
});

describe('isReadyToProcessLabelAdded', () => {
	it('returns true when ready-to-process label added', () => {
		const result = isReadyToProcessLabelAdded(
			'addLabelToCard',
			{ label: { id: 'label-ready' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false for wrong action type', () => {
		const result = isReadyToProcessLabelAdded(
			'commentCard',
			{ label: { id: 'label-ready' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns false for different label', () => {
		const result = isReadyToProcessLabelAdded(
			'addLabelToCard',
			{ label: { id: 'label-other' } },
			mockProject,
		);
		expect(result).toBe(false);
	});
});

describe('isAgentLogAttachmentUploaded', () => {
	it('returns true for matching attachment name', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'implementation-2026-01-02T16-30-24-339Z.zip' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false for debug- prefixed attachments', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'debug-2026-01-02T16-30-24-339Z.zip' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns false when project has no debug list', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'implementation-2026-01-02T16-30-24-339Z.zip' } },
			{
				...mockProject,
				trello: { ...mockProject.trello, lists: { ...mockProject.trello?.lists, debug: '' } },
			},
		);
		expect(result).toBe(false);
	});
});

describe('isSelfAuthoredTrelloComment', () => {
	it('returns true when comment author matches bot ID', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'bot-id' } },
			'p1',
		);
		expect(result).toBe(true);
	});

	it('returns false when comment author does not match', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'user-id' } },
			'p1',
		);
		expect(result).toBe(false);
	});

	it('returns false when identity resolution fails', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockRejectedValue(new Error('DB error'));
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'bot-id' } },
			'p1',
		);
		expect(result).toBe(false);
	});
});
