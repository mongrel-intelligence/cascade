import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveAllAgentDefinitions, mockResolveKnownAgentTypes } = vi.hoisted(() => ({
	mockResolveAllAgentDefinitions: vi.fn(),
	mockResolveKnownAgentTypes: vi.fn(),
}));

vi.mock('../../../src/agents/definitions/index.js', () => ({
	resolveAllAgentDefinitions: mockResolveAllAgentDefinitions,
	resolveKnownAgentTypes: mockResolveKnownAgentTypes,
}));

import {
	_resetAgentMessages,
	AGENT_LABELS,
	AGENT_ROLE_HINTS,
	getAgentLabel,
	INITIAL_MESSAGES,
	initAgentMessages,
} from '../../../src/config/agentMessages.js';

function makeDefinition(overrides: Record<string, unknown> = {}) {
	return {
		identity: {
			emoji: '🧑‍💻',
			label: 'Implementation Update',
			roleHint: 'Writes code and creates pull requests',
			initialMessage: '**🧑‍💻 Implementing changes** — Working on the task...',
			...overrides,
		},
	};
}

describe('initAgentMessages', () => {
	beforeEach(() => {
		_resetAgentMessages();
		vi.resetAllMocks();
	});

	it('populates labels, roleHints, and initialMessages from definitions', async () => {
		const allDefs = new Map([
			['implementation', makeDefinition()],
			[
				'review',
				makeDefinition({
					emoji: '🔍',
					label: 'Code Review',
					roleHint: 'Reviews code quality',
					initialMessage: '**🔍 Reviewing** — Examining code...',
				}),
			],
		]);
		mockResolveAllAgentDefinitions.mockResolvedValue(allDefs);
		mockResolveKnownAgentTypes.mockResolvedValue(['implementation', 'review']);

		await initAgentMessages();

		expect(AGENT_LABELS.implementation).toEqual({
			emoji: '🧑‍💻',
			label: 'Implementation Update',
		});
		expect(AGENT_LABELS.review).toEqual({ emoji: '🔍', label: 'Code Review' });
		expect(AGENT_ROLE_HINTS.implementation).toBe('Writes code and creates pull requests');
		expect(INITIAL_MESSAGES.implementation).toBe(
			'**🧑‍💻 Implementing changes** — Working on the task...',
		);
	});

	it('skips agent types with no matching definition', async () => {
		const allDefs = new Map([['implementation', makeDefinition()]]);
		mockResolveAllAgentDefinitions.mockResolvedValue(allDefs);
		mockResolveKnownAgentTypes.mockResolvedValue(['implementation', 'unknown-agent']);

		await initAgentMessages();

		expect(AGENT_LABELS.implementation).toBeDefined();
		expect(AGENT_LABELS['unknown-agent']).toBeUndefined();
	});
});

describe('proxy guards (pre-init access)', () => {
	beforeEach(() => {
		_resetAgentMessages();
		vi.resetAllMocks();
	});

	it('AGENT_LABELS throws when accessed before init', () => {
		expect(() => AGENT_LABELS.implementation).toThrow(
			"agentMessages: 'AGENT_LABELS' was accessed before initAgentMessages() completed",
		);
	});

	it('AGENT_ROLE_HINTS throws when accessed before init', () => {
		expect(() => AGENT_ROLE_HINTS.implementation).toThrow(
			"agentMessages: 'AGENT_ROLE_HINTS' was accessed before initAgentMessages() completed",
		);
	});

	it('INITIAL_MESSAGES throws when accessed before init', () => {
		expect(() => INITIAL_MESSAGES.implementation).toThrow(
			"agentMessages: 'INITIAL_MESSAGES' was accessed before initAgentMessages() completed",
		);
	});

	it('getAgentLabel throws when accessed before init', () => {
		expect(() => getAgentLabel('implementation')).toThrow(
			"agentMessages: 'getAgentLabel' was accessed before initAgentMessages() completed",
		);
	});
});

describe('getAgentLabel', () => {
	beforeEach(async () => {
		_resetAgentMessages();
		vi.resetAllMocks();
		const allDefs = new Map([['implementation', makeDefinition()]]);
		mockResolveAllAgentDefinitions.mockResolvedValue(allDefs);
		mockResolveKnownAgentTypes.mockResolvedValue(['implementation']);
		await initAgentMessages();
	});

	it('returns label for known agent type', () => {
		const label = getAgentLabel('implementation');
		expect(label).toEqual({ emoji: '🧑‍💻', label: 'Implementation Update' });
	});

	it('returns generic fallback for unknown agent type', () => {
		const label = getAgentLabel('unknown-agent-xyz');
		expect(label).toEqual({ emoji: '⚙️', label: 'Progress Update' });
	});
});

describe('_resetAgentMessages', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('clears state so proxy guards throw again after reset', async () => {
		const allDefs = new Map([['implementation', makeDefinition()]]);
		mockResolveAllAgentDefinitions.mockResolvedValue(allDefs);
		mockResolveKnownAgentTypes.mockResolvedValue(['implementation']);
		await initAgentMessages();

		// Should work after init
		expect(() => AGENT_LABELS.implementation).not.toThrow();

		// Reset and re-test
		_resetAgentMessages();
		expect(() => AGENT_LABELS.implementation).toThrow();
	});

	it('removes all populated data', async () => {
		const allDefs = new Map([['implementation', makeDefinition()]]);
		mockResolveAllAgentDefinitions.mockResolvedValue(allDefs);
		mockResolveKnownAgentTypes.mockResolvedValue(['implementation']);
		await initAgentMessages();
		_resetAgentMessages();

		// Re-init with fresh data
		const emptyDefs = new Map();
		mockResolveAllAgentDefinitions.mockResolvedValue(emptyDefs);
		mockResolveKnownAgentTypes.mockResolvedValue([]);
		await initAgentMessages();

		// Should be empty after reset and re-init with empty data
		expect(() => AGENT_LABELS.implementation).not.toThrow();
		expect(AGENT_LABELS.implementation).toBeUndefined();
	});
});
