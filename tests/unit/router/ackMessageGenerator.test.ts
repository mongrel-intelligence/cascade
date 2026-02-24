import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy imports before importing the module under test
vi.mock('llmist', () => {
	const mockRun = vi.fn();
	const mockBuilder = {
		withModel: vi.fn().mockReturnThis(),
		withTemperature: vi.fn().mockReturnThis(),
		withSystem: vi.fn().mockReturnThis(),
		withMaxIterations: vi.fn().mockReturnThis(),
		withGadgets: vi.fn().mockReturnThis(),
		ask: vi.fn().mockReturnValue({ run: mockRun }),
	};
	return {
		LLMist: vi.fn().mockImplementation(() => ({})),
		AgentBuilder: vi.fn().mockImplementation(() => mockBuilder),
		__mockBuilder: mockBuilder,
		__mockRun: mockRun,
	};
});

vi.mock('../../../src/config/provider.js', () => ({
	loadConfig: vi.fn(),
	getOrgCredential: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/config/customModels.js', () => ({
	CUSTOM_MODELS: [],
}));

vi.mock('../../../src/config/agentMessages.js', () => ({
	INITIAL_MESSAGES: {
		implementation:
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		briefing:
			'**📋 Analyzing brief** — Reading the card and gathering context to create a clear brief...',
		review: '**🔍 Reviewing code** — Examining the PR changes for quality and correctness...',
	},
}));

import { getOrgCredential, loadConfig } from '../../../src/config/provider.js';
import {
	extractGitHubContext,
	extractJiraContext,
	extractTrelloContext,
	generateAckMessage,
} from '../../../src/router/ackMessageGenerator.js';

// Access llmist mocks — test-only mock internals
const llmistModule = (await import('llmist')) as Record<string, unknown>;
const mockRun = llmistModule.__mockRun as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Context extractors
// ---------------------------------------------------------------------------

describe('extractTrelloContext', () => {
	it('extracts card name from payload', () => {
		const payload = {
			action: {
				type: 'updateCard',
				data: {
					card: { id: 'card1', name: 'Add dark mode support' },
				},
			},
		};
		const result = extractTrelloContext(payload);
		expect(result).toBe('Card: Add dark mode support');
	});

	it('extracts card name and comment text for commentCard actions', () => {
		const payload = {
			action: {
				type: 'commentCard',
				data: {
					card: { id: 'card1', name: 'Fix auth bug' },
					text: 'Please also check the session handling',
				},
			},
		};
		const result = extractTrelloContext(payload);
		expect(result).toContain('Card: Fix auth bug');
		expect(result).toContain('Comment: Please also check the session handling');
	});

	it('returns empty string for null payload', () => {
		expect(extractTrelloContext(null)).toBe('');
	});

	it('returns empty string for payload without action', () => {
		expect(extractTrelloContext({})).toBe('');
	});

	it('returns empty string for payload without data', () => {
		expect(extractTrelloContext({ action: { type: 'updateCard' } })).toBe('');
	});

	it('truncates long context to max length', () => {
		const longName = 'A'.repeat(600);
		const payload = {
			action: {
				type: 'updateCard',
				data: { card: { id: 'card1', name: longName } },
			},
		};
		const result = extractTrelloContext(payload);
		// "Card: " is 6 chars, so total should be truncated to 500 + "…"
		expect(result.length).toBeLessThanOrEqual(501);
		expect(result.endsWith('…')).toBe(true);
	});
});

describe('extractGitHubContext', () => {
	it('extracts PR title from pull_request event', () => {
		const payload = {
			pull_request: { title: 'feat: add dark mode', number: 42 },
		};
		const result = extractGitHubContext(payload, 'pull_request');
		expect(result).toBe('PR: feat: add dark mode');
	});

	it('extracts PR title and comment body from issue_comment event', () => {
		const payload = {
			pull_request: { title: 'feat: add dark mode' },
			comment: { body: '@cascade please fix the linting errors' },
		};
		const result = extractGitHubContext(payload, 'issue_comment');
		expect(result).toContain('PR: feat: add dark mode');
		expect(result).toContain('Comment: @cascade please fix the linting errors');
	});

	it('extracts PR title and review body from pull_request_review event', () => {
		const payload = {
			pull_request: { title: 'fix: auth bug' },
			review: { body: 'Please handle the edge case for expired tokens' },
		};
		const result = extractGitHubContext(payload, 'pull_request_review');
		expect(result).toContain('PR: fix: auth bug');
		expect(result).toContain('Review: Please handle the edge case for expired tokens');
	});

	it('extracts comment from pull_request_review_comment event', () => {
		const payload = {
			pull_request: { title: 'refactor: cleanup' },
			comment: { body: 'This function should be extracted' },
		};
		const result = extractGitHubContext(payload, 'pull_request_review_comment');
		expect(result).toContain('Comment: This function should be extracted');
	});

	it('returns empty string for null payload', () => {
		expect(extractGitHubContext(null, 'pull_request')).toBe('');
	});

	it('returns empty string for payload without PR', () => {
		expect(extractGitHubContext({}, 'check_suite')).toBe('');
	});

	it('truncates long context', () => {
		const longTitle = 'B'.repeat(600);
		const payload = { pull_request: { title: longTitle } };
		const result = extractGitHubContext(payload, 'pull_request');
		expect(result.length).toBeLessThanOrEqual(501);
		expect(result.endsWith('…')).toBe(true);
	});
});

describe('extractJiraContext', () => {
	it('extracts issue summary from payload', () => {
		const payload = {
			issue: {
				key: 'PROJ-123',
				fields: { summary: 'Implement user authentication' },
			},
		};
		const result = extractJiraContext(payload);
		expect(result).toBe('Issue: Implement user authentication');
	});

	it('extracts issue summary and comment body', () => {
		const payload = {
			issue: {
				key: 'PROJ-123',
				fields: { summary: 'Fix login bug' },
			},
			comment: { body: 'This also affects the password reset flow' },
		};
		const result = extractJiraContext(payload);
		expect(result).toContain('Issue: Fix login bug');
		expect(result).toContain('Comment: This also affects the password reset flow');
	});

	it('returns empty string for null payload', () => {
		expect(extractJiraContext(null)).toBe('');
	});

	it('returns empty string for payload without issue', () => {
		expect(extractJiraContext({})).toBe('');
	});

	it('extracts comment even without issue', () => {
		const payload = {
			comment: { body: 'Some standalone comment' },
		};
		const result = extractJiraContext(payload);
		expect(result).toBe('Comment: Some standalone comment');
	});

	it('truncates long context', () => {
		const longSummary = 'C'.repeat(600);
		const payload = {
			issue: { key: 'PROJ-1', fields: { summary: longSummary } },
		};
		const result = extractJiraContext(payload);
		expect(result.length).toBeLessThanOrEqual(501);
		expect(result.endsWith('…')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// generateAckMessage
// ---------------------------------------------------------------------------

describe('generateAckMessage', () => {
	function setupHappyPath(llmResponse: string) {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue('sk-test-key');

		// Mock the async iterator returned by agent.run()
		async function* fakeRun() {
			yield { type: 'text' as const, content: llmResponse };
		}
		mockRun.mockReturnValue(fakeRun());
	}

	it('returns LLM-generated message on happy path', async () => {
		setupHappyPath('**🚀 Implementing dark mode** — Adding dark mode support to the application.');

		const result = await generateAckMessage('implementation', 'Card: Add dark mode support', 'p1');

		expect(result).toBe(
			'**🚀 Implementing dark mode** — Adding dark mode support to the application.',
		);
		expect(loadConfig).toHaveBeenCalled();
		expect(getOrgCredential).toHaveBeenCalledWith('p1', 'OPENROUTER_API_KEY');
	});

	it('falls back to static message when context snippet is empty', async () => {
		const result = await generateAckMessage('implementation', '', 'p1');

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
		expect(loadConfig).not.toHaveBeenCalled();
	});

	it('falls back to static message when context is only whitespace', async () => {
		const result = await generateAckMessage('implementation', '   ', 'p1');

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
		expect(loadConfig).not.toHaveBeenCalled();
	});

	it('falls back to static message when progressModel is not configured', async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: '' },
		} as never);

		const result = await generateAckMessage('implementation', 'Card: Test', 'p1');

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
	});

	it('falls back to static message when no API key', async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue(null);

		const result = await generateAckMessage('briefing', 'Card: Test', 'p1');

		expect(result).toBe(
			'**📋 Analyzing brief** — Reading the card and gathering context to create a clear brief...',
		);
	});

	it('falls back to static message when LLM call throws', async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue('sk-test-key');
		mockRun.mockImplementation(() => {
			throw new Error('Network error');
		});

		const result = await generateAckMessage('implementation', 'Card: Test', 'p1');

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
	});

	it('falls back to static message when LLM returns empty output', async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue('sk-test-key');

		async function* emptyRun() {
			// Yields nothing
		}
		mockRun.mockReturnValue(emptyRun());

		const result = await generateAckMessage('implementation', 'Card: Test', 'p1');

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
	});

	it('falls back to generic message for unknown agent types', async () => {
		const result = await generateAckMessage('unknown-agent', '', 'p1');

		expect(result).toBe('**⚙️ Working on it** — Processing your request...');
	});

	it('restores process.env after successful call', async () => {
		const originalKey = process.env.OPENROUTER_API_KEY;
		setupHappyPath('**🚀 Test message**');

		await generateAckMessage('implementation', 'Card: Test', 'p1');

		expect(process.env.OPENROUTER_API_KEY).toBe(originalKey);
	});

	it('restores process.env after failed call', async () => {
		const originalKey = process.env.OPENROUTER_API_KEY;
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue('sk-test-key');
		mockRun.mockImplementation(() => {
			throw new Error('LLM error');
		});

		await generateAckMessage('implementation', 'Card: Test', 'p1');

		expect(process.env.OPENROUTER_API_KEY).toBe(originalKey);
	});

	it('falls back to static message on timeout', async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			defaults: { progressModel: 'openrouter:google/gemini-2.5-flash-lite' },
		} as never);
		vi.mocked(getOrgCredential).mockResolvedValue('sk-test-key');

		// Simulate a call that never resolves (will be beaten by the 5s timeout)
		let resolveHang: () => void;
		const hangForever = new Promise<void>((r) => {
			resolveHang = r;
		});
		async function* slowRun() {
			await hangForever;
			yield { type: 'text' as const, content: 'too late' };
		}
		mockRun.mockReturnValue(slowRun());

		const result = await generateAckMessage('implementation', 'Card: Test', 'p1');

		// Clean up the hanging promise so it doesn't leak
		resolveHang?.();

		expect(result).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
	}, 10_000);
});
