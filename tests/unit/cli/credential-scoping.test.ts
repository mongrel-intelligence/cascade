import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));

import { CredentialScopedCommand } from '../../../src/cli/base.js';
import { withGitHubToken } from '../../../src/github/client.js';
import { withTrelloCredentials } from '../../../src/trello/client.js';

class TestCommand extends CredentialScopedCommand {
	static override id = 'test';
	static override description = 'Test command';
	executeCalled = false;

	async execute(): Promise<void> {
		this.executeCalled = true;
	}
}

describe('CredentialScopedCommand', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		process.env.GITHUB_TOKEN = undefined;
		process.env.TRELLO_API_KEY = undefined;
		process.env.TRELLO_TOKEN = undefined;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('calls execute() without scoping when no env vars are set', async () => {
		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).not.toHaveBeenCalled();
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps execute() with withGitHubToken when GITHUB_TOKEN is set', async () => {
		process.env.GITHUB_TOKEN = 'ghp_test123';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).toHaveBeenCalledWith('ghp_test123', expect.any(Function));
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps execute() with withTrelloCredentials when TRELLO_API_KEY and TRELLO_TOKEN are set', async () => {
		process.env.TRELLO_API_KEY = 'trello-key';
		process.env.TRELLO_TOKEN = 'trello-token';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
		expect(withGitHubToken).not.toHaveBeenCalled();
	});

	it('does not wrap with Trello credentials when only TRELLO_API_KEY is set', async () => {
		process.env.TRELLO_API_KEY = 'trello-key';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps with both GitHub and Trello scoping when all env vars are set', async () => {
		process.env.GITHUB_TOKEN = 'ghp_test123';
		process.env.TRELLO_API_KEY = 'trello-key';
		process.env.TRELLO_TOKEN = 'trello-token';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).toHaveBeenCalledWith('ghp_test123', expect.any(Function));
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
	});
});
