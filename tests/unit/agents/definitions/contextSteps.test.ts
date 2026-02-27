import { describe, expect, it } from 'vitest';

import { fetchEmailsFromInputStep } from '../../../../src/agents/definitions/contextSteps.js';
import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import type { EmailSummary } from '../../../../src/email/types.js';
import type { AgentInput } from '../../../../src/types/index.js';

function makeParams(input: Partial<AgentInput>): FetchContextParams {
	return {
		input: input as AgentInput,
		repoDir: '/tmp/repo',
		contextFiles: [],
		logWriter: () => {},
	};
}

describe('fetchEmailsFromInputStep', () => {
	it('returns empty array when preFoundEmails is undefined', () => {
		const result = fetchEmailsFromInputStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when preFoundEmails is an empty array', () => {
		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [] }));
		expect(result).toEqual([]);
	});

	it('injects a single email with correct toolName, params, result, and description', () => {
		const email: EmailSummary = {
			uid: 42,
			date: new Date('2024-01-15T10:30:00Z'),
			from: 'sender@x.com',
			to: ['me@example.com'],
			subject: 'Subject',
			snippet: 'Snippet text',
		};

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [email] }));

		expect(result).toHaveLength(1);
		const injection = result[0];

		expect(injection.toolName).toBe('SearchEmails');
		expect(injection.params).toEqual({
			comment: 'Pre-fetched unread emails before agent start',
			folder: 'INBOX',
			criteria: { unseen: true },
			maxResults: 10,
		});
		expect(injection.result).toBe(
			'Found 1 email(s):\n\n1. [UID:42] 2024-01-15 - "Subject" from sender@x.com',
		);
		expect(injection.description).toBe('Pre-fetched 1 unread email(s)');
	});

	it('includes criteria.from when senderEmail is set', () => {
		const email: EmailSummary = {
			uid: 7,
			date: new Date('2024-06-01T00:00:00Z'),
			from: 'boss@company.com',
			to: ['me@example.com'],
			subject: 'Hi',
			snippet: '',
		};

		const result = fetchEmailsFromInputStep(
			makeParams({ preFoundEmails: [email], senderEmail: 'boss@company.com' }),
		);

		expect(result[0].params).toEqual(
			expect.objectContaining({ criteria: { unseen: true, from: 'boss@company.com' } }),
		);
	});

	it('formats multiple emails as a numbered list with correct count in description', () => {
		const emails: EmailSummary[] = [
			{
				uid: 1,
				date: new Date('2024-03-10T00:00:00Z'),
				from: 'a@example.com',
				to: [],
				subject: 'First',
				snippet: '',
			},
			{
				uid: 2,
				date: new Date('2024-03-11T00:00:00Z'),
				from: 'b@example.com',
				to: [],
				subject: 'Second',
				snippet: '',
			},
		];

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: emails }));

		expect(result).toHaveLength(1);
		expect(result[0].description).toBe('Pre-fetched 2 unread email(s)');
		expect(result[0].result).toBe(
			'Found 2 email(s):\n\n' +
				'1. [UID:1] 2024-03-10 - "First" from a@example.com\n' +
				'2. [UID:2] 2024-03-11 - "Second" from b@example.com',
		);
	});

	it('extracts the date using UTC ISO split (ignores time component)', () => {
		const email: EmailSummary = {
			uid: 99,
			date: new Date('2024-12-31T23:59:59Z'),
			from: 'test@example.com',
			to: [],
			subject: 'NYE',
			snippet: '',
		};

		const result = fetchEmailsFromInputStep(makeParams({ preFoundEmails: [email] }));

		expect(result[0].result).toContain('2024-12-31');
	});
});
