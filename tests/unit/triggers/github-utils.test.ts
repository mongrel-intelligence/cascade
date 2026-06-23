import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

const mockGetPMProviderOrNull = vi.fn();
vi.mock('../../../src/pm/context.js', () => ({
	getPMProviderOrNull: () => mockGetPMProviderOrNull(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import type { PersonaIdentities } from '../../../src/github/personas.js';
import {
	evaluateAuthorMode,
	extractJiraIssueKey,
	extractJiraKeyFromPR,
	extractTrelloCardId,
	extractWorkItemId,
	parsePrNumberFromRef,
	resolveWorkItemId,
	resolveWorkItemIdWithFallback,
} from '../../../src/triggers/github/utils.js';
import type { ProjectConfig } from '../../../src/types/index.js';

const mockTrelloProject: ProjectConfig = {
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
	},
};

const mockJiraProject: ProjectConfig = {
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'jira' },
	jira: {
		host: 'example.atlassian.net',
		projectKey: 'TEST',
	},
};

describe('extractTrelloCardId', () => {
	it('returns null for null input', () => {
		expect(extractTrelloCardId(null)).toBeNull();
	});

	it('returns null for text with no URL', () => {
		expect(extractTrelloCardId('Just some regular text')).toBeNull();
	});

	it('extracts card ID from valid Trello URL', () => {
		const text = 'Implements https://trello.com/c/abc123/card-name';
		expect(extractTrelloCardId(text)).toBe('abc123');
	});

	it('extracts card ID from URL without slug', () => {
		const text = 'See https://trello.com/c/xyz789';
		expect(extractTrelloCardId(text)).toBe('xyz789');
	});

	it('returns first card ID when multiple URLs present', () => {
		const text =
			'https://trello.com/c/first123/card-one and https://trello.com/c/second456/card-two';
		expect(extractTrelloCardId(text)).toBe('first123');
	});

	it('handles URLs with alphanumeric IDs', () => {
		const text = 'https://trello.com/c/AbC123DeF/my-card';
		expect(extractTrelloCardId(text)).toBe('AbC123DeF');
	});
});

describe('extractJiraIssueKey', () => {
	it('returns null for null input', () => {
		expect(extractJiraIssueKey(null)).toBeNull();
	});

	it('returns null when no key found', () => {
		expect(extractJiraIssueKey('Just some text without a key')).toBeNull();
	});

	it('extracts valid JIRA key', () => {
		expect(extractJiraIssueKey('PROJ-123')).toBe('PROJ-123');
	});

	it('extracts key embedded in longer text', () => {
		const text = 'This fixes PROJ-456 by updating the logic';
		expect(extractJiraIssueKey(text)).toBe('PROJ-456');
	});

	it('extracts key with multiple characters in project code', () => {
		expect(extractJiraIssueKey('TEST-999')).toBe('TEST-999');
	});

	it('extracts key with alphanumeric project code', () => {
		expect(extractJiraIssueKey('AB12-345')).toBe('AB12-345');
	});

	it('requires word boundaries around key', () => {
		// Should not match partial strings
		expect(extractJiraIssueKey('NOTAKEY-123-MORE')).toBe('NOTAKEY-123');
	});

	it('returns first key when multiple present', () => {
		const text = 'Relates to PROJ-111 and PROJ-222';
		expect(extractJiraIssueKey(text)).toBe('PROJ-111');
	});
});

describe('extractWorkItemId', () => {
	it('returns null for null input', () => {
		expect(extractWorkItemId(null, mockTrelloProject)).toBeNull();
	});

	it('delegates to Trello extraction for Trello projects', () => {
		const text = 'https://trello.com/c/abc123/card';
		expect(extractWorkItemId(text, mockTrelloProject)).toBe('abc123');
	});

	it('delegates to JIRA extraction for JIRA projects', () => {
		const text = 'Fixes PROJ-456';
		expect(extractWorkItemId(text, mockJiraProject)).toBe('PROJ-456');
	});

	it('returns null for Trello project without Trello URL', () => {
		const text = 'Just regular text';
		expect(extractWorkItemId(text, mockTrelloProject)).toBeNull();
	});

	it('returns null for JIRA project without JIRA key', () => {
		const text = 'Just regular text';
		expect(extractWorkItemId(text, mockJiraProject)).toBeNull();
	});
});

describe('resolveWorkItemId', () => {
	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
	});

	it('returns DB result when available', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('db-item-123');

		const result = await resolveWorkItemId('proj', 42);

		expect(result).toBe('db-item-123');
		expect(lookupWorkItemForPR).toHaveBeenCalledWith('proj', 42);
	});

	it('returns undefined when DB returns null', async () => {
		const result = await resolveWorkItemId('proj', 42);

		expect(result).toBeUndefined();
	});

	it('returns undefined when DB throws', async () => {
		vi.mocked(lookupWorkItemForPR).mockRejectedValue(new Error('DB connection failed'));

		const result = await resolveWorkItemId('proj', 42);

		expect(result).toBeUndefined();
	});
});

describe('extractJiraKeyFromPR', () => {
	it('returns null for a non-JIRA project', () => {
		expect(extractJiraKeyFromPR(mockTrelloProject, { branch: 'TEST-1' })).toBeNull();
	});

	it('extracts a project-scoped key from the branch (case-insensitive, upper-normalized)', () => {
		expect(extractJiraKeyFromPR(mockJiraProject, { branch: 'feature/test-123-fix' })).toBe(
			'TEST-123',
		);
	});

	it('falls back to the title when the branch has no key', () => {
		expect(
			extractJiraKeyFromPR(mockJiraProject, { branch: 'fix/thing', title: 'TEST-77: do it' }),
		).toBe('TEST-77');
	});

	it('uses only the last non-empty line of the body', () => {
		const body =
			'From the user perspective:\r\n- dropping support for iOS 15 which is ancient anyway\r\n\r\nTEST-2068';
		expect(extractJiraKeyFromPR(mockJiraProject, { body })).toBe('TEST-2068');
	});

	it('ignores a key that is not on the last non-empty line of the body', () => {
		const body = 'TEST-999 mentioned mid-prose\r\nlast line has no key';
		expect(extractJiraKeyFromPR(mockJiraProject, { body })).toBeNull();
	});

	it('rejects non-project tokens (UTF-8 / another project key)', () => {
		expect(extractJiraKeyFromPR(mockJiraProject, { title: 'fix UTF-8 and OTHER-5' })).toBeNull();
	});

	it('prefers branch over title over body', () => {
		expect(
			extractJiraKeyFromPR(mockJiraProject, { branch: 'TEST-1', title: 'TEST-2', body: 'TEST-3' }),
		).toBe('TEST-1');
	});

	it('returns null when no source carries a key', () => {
		expect(
			extractJiraKeyFromPR(mockJiraProject, { branch: 'fix/x', title: 'no key', body: 'nothing' }),
		).toBeNull();
	});
});

describe('resolveWorkItemIdWithFallback', () => {
	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockReset();
		mockGetPMProviderOrNull.mockReset();
	});

	it('returns the DB link when present, without extracting', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('TEST-500');
		const got = await resolveWorkItemIdWithFallback(mockJiraProject, 42, { branch: 'TEST-1' });
		expect(got).toBe('TEST-500');
		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
	});

	it('derives and verifies the key on a DB miss', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
		const getWorkItem = vi.fn().mockResolvedValue({ id: 'TEST-123' });
		mockGetPMProviderOrNull.mockReturnValue({ getWorkItem });
		const got = await resolveWorkItemIdWithFallback(mockJiraProject, 42, {
			branch: 'feature/TEST-123-fix',
		});
		expect(got).toBe('TEST-123');
		expect(getWorkItem).toHaveBeenCalledWith('TEST-123');
	});

	it('does not link when the derived key does not resolve (getWorkItem throws)', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
		const getWorkItem = vi.fn().mockRejectedValue(new Error('404'));
		mockGetPMProviderOrNull.mockReturnValue({ getWorkItem });
		const got = await resolveWorkItemIdWithFallback(mockJiraProject, 42, {
			body: 'x\r\nTEST-9999',
		});
		expect(got).toBeUndefined();
	});

	it('returns undefined (and skips the provider) when no key is found', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
		const got = await resolveWorkItemIdWithFallback(mockJiraProject, 42, {
			branch: 'fix/x',
			title: 'no key',
		});
		expect(got).toBeUndefined();
		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
	});

	it('returns undefined when no PM provider is in scope', async () => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
		mockGetPMProviderOrNull.mockReturnValue(null);
		const got = await resolveWorkItemIdWithFallback(mockJiraProject, 42, { branch: 'TEST-7' });
		expect(got).toBeUndefined();
	});
});

describe('parsePrNumberFromRef', () => {
	it('returns null for null input', () => {
		expect(parsePrNumberFromRef(null)).toBeNull();
	});

	it('returns null for undefined input', () => {
		expect(parsePrNumberFromRef(undefined)).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parsePrNumberFromRef('')).toBeNull();
	});

	it('returns null for a plain branch name', () => {
		expect(parsePrNumberFromRef('main')).toBeNull();
	});

	it('returns null for a feature branch', () => {
		expect(parsePrNumberFromRef('feature/my-branch')).toBeNull();
	});

	it('returns null for refs/pull/{N}/merge (merge-commit ref not supported)', () => {
		expect(parsePrNumberFromRef('refs/pull/42/merge')).toBeNull();
	});

	it('returns PR number for refs/pull/{N}/head', () => {
		expect(parsePrNumberFromRef('refs/pull/42/head')).toBe(42);
	});

	it('returns PR number for large PR numbers', () => {
		expect(parsePrNumberFromRef('refs/pull/1030/head')).toBe(1030);
	});

	it('returns null for partial match (no leading refs/pull/)', () => {
		expect(parsePrNumberFromRef('pull/42/head')).toBeNull();
	});
});

describe('evaluateAuthorMode', () => {
	const personas: PersonaIdentities = {
		implementer: 'cascade-impl',
		reviewer: 'cascade-reviewer',
	};

	it('returns null when personaIdentities is undefined', () => {
		const result = evaluateAuthorMode('some-user', undefined, {}, 'test-handler');
		expect(result).toBeNull();
	});

	it('returns shouldTrigger:true + isCascadePR:true for implementer login when authorMode=own', () => {
		const result = evaluateAuthorMode('cascade-impl', personas, { authorMode: 'own' }, 'handler');
		expect(result).toEqual({ shouldTrigger: true, authorMode: 'own', isCascadePR: true });
	});

	it('returns shouldTrigger:true + isCascadePR:true for reviewer login when authorMode=own (core bug regression)', () => {
		const result = evaluateAuthorMode(
			'cascade-reviewer',
			personas,
			{ authorMode: 'own' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: true, authorMode: 'own', isCascadePR: true });
	});

	it('returns shouldTrigger:true + isCascadePR:true for implementer[bot] variant when authorMode=own', () => {
		const result = evaluateAuthorMode(
			'cascade-impl[bot]',
			personas,
			{ authorMode: 'own' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: true, authorMode: 'own', isCascadePR: true });
	});

	it('returns shouldTrigger:true + isCascadePR:true for reviewer[bot] variant when authorMode=own', () => {
		const result = evaluateAuthorMode(
			'cascade-reviewer[bot]',
			personas,
			{ authorMode: 'own' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: true, authorMode: 'own', isCascadePR: true });
	});

	it('returns shouldTrigger:false for external author when authorMode=own', () => {
		const result = evaluateAuthorMode('external-dev', personas, { authorMode: 'own' }, 'handler');
		expect(result).toEqual({ shouldTrigger: false, authorMode: 'own', isCascadePR: false });
	});

	it('returns shouldTrigger:true for external author when authorMode=external', () => {
		const result = evaluateAuthorMode(
			'external-dev',
			personas,
			{ authorMode: 'external' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: true, authorMode: 'external', isCascadePR: false });
	});

	it('returns shouldTrigger:false for implementer when authorMode=external', () => {
		const result = evaluateAuthorMode(
			'cascade-impl',
			personas,
			{ authorMode: 'external' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: false, authorMode: 'external', isCascadePR: true });
	});

	it('returns shouldTrigger:false for reviewer when authorMode=external (second regression test)', () => {
		const result = evaluateAuthorMode(
			'cascade-reviewer',
			personas,
			{ authorMode: 'external' },
			'handler',
		);
		expect(result).toEqual({ shouldTrigger: false, authorMode: 'external', isCascadePR: true });
	});

	it('returns shouldTrigger:true for any author when authorMode=all', () => {
		for (const login of ['cascade-impl', 'cascade-reviewer', 'external-dev']) {
			const result = evaluateAuthorMode(login, personas, { authorMode: 'all' }, 'handler');
			expect(result?.shouldTrigger).toBe(true);
			expect(result?.authorMode).toBe('all');
		}
	});

	it('falls back to "own" when authorMode is an invalid string', () => {
		const result = evaluateAuthorMode(
			'cascade-impl',
			personas,
			{ authorMode: 'invalid' },
			'handler',
		);
		expect(result?.authorMode).toBe('own');
		expect(result?.shouldTrigger).toBe(true);
	});

	it('falls back to "own" when authorMode is missing from parameters', () => {
		const result = evaluateAuthorMode('cascade-impl', personas, {}, 'handler');
		expect(result?.authorMode).toBe('own');
		expect(result?.shouldTrigger).toBe(true);
	});
});
