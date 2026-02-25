import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(),
}));

vi.mock('../../../src/utils/safeOperation.js', () => ({
	safeOperation: vi.fn((fn) => fn()),
}));

import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProvider } from '../../../src/pm/index.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import type { AgentResult, ProjectConfig } from '../../../src/types/index.js';
import { createMockJiraProject, createMockProject } from '../../helpers/factories.js';

const mockPMProvider = {
	getCustomFieldNumber: vi.fn(),
	updateCustomFieldNumber: vi.fn(),
};

vi.mocked(getPMProvider).mockReturnValue(mockPMProvider as unknown as PMProvider);

const mockTrelloProject: ProjectConfig = createMockProject({
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
		customFields: { cost: 'cf-cost-123' },
	},
});

const mockJiraProject: ProjectConfig = createMockJiraProject({
	id: 'test',
	name: 'Test',
	repo: 'owner/repo',
	pm: { type: 'jira' },
	jira: {
		host: 'example.atlassian.net',
		projectKey: 'TEST',
		customFields: { cost: 'cf-jira-cost-456' },
	},
});

describe('handleAgentResultArtifacts', () => {
	it('updates cost custom field with accumulation', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(2.5);

		const agentResult: AgentResult = {
			success: true,
			cost: 1.75,
			sessionId: 'session-123',
		};

		await handleAgentResultArtifacts('card123', 'implementation', agentResult, mockTrelloProject);

		expect(mockPMProvider.getCustomFieldNumber).toHaveBeenCalledWith('card123', 'cf-cost-123');
		expect(mockPMProvider.updateCustomFieldNumber).toHaveBeenCalledWith(
			'card123',
			'cf-cost-123',
			4.25,
		);
	});

	it('handles zero current cost', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(0);

		const agentResult: AgentResult = {
			success: true,
			cost: 3.5,
			sessionId: 'session-456',
		};

		await handleAgentResultArtifacts('card456', 'review', agentResult, mockTrelloProject);

		expect(mockPMProvider.updateCustomFieldNumber).toHaveBeenCalledWith(
			'card456',
			'cf-cost-123',
			3.5,
		);
	});

	it('rounds accumulated cost to 4 decimal places', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(1.123456);

		const agentResult: AgentResult = {
			success: true,
			cost: 0.987654,
			sessionId: 'session-789',
		};

		await handleAgentResultArtifacts('card789', 'implementation', agentResult, mockTrelloProject);

		// 1.123456 + 0.987654 = 2.11111, rounded to 4 decimals = 2.1111
		expect(mockPMProvider.updateCustomFieldNumber).toHaveBeenCalledWith(
			'card789',
			'cf-cost-123',
			2.1111,
		);
	});

	it('skips when no cost field configured (Trello)', async () => {
		const projectNoCostField: ProjectConfig = {
			...mockTrelloProject,
			trello: mockTrelloProject.trello
				? {
						...mockTrelloProject.trello,
						customFields: {},
					}
				: undefined,
		};

		const agentResult: AgentResult = {
			success: true,
			cost: 1.5,
			sessionId: 'session-abc',
		};

		await handleAgentResultArtifacts(
			'card-no-field',
			'implementation',
			agentResult,
			projectNoCostField,
		);

		expect(mockPMProvider.getCustomFieldNumber).not.toHaveBeenCalled();
		expect(mockPMProvider.updateCustomFieldNumber).not.toHaveBeenCalled();
	});

	it('skips when no cost field configured (JIRA)', async () => {
		const projectNoCostField: ProjectConfig = {
			...mockJiraProject,
			jira: mockJiraProject.jira
				? {
						...mockJiraProject.jira,
						customFields: {},
					}
				: undefined,
		};

		const agentResult: AgentResult = {
			success: true,
			cost: 2.0,
			sessionId: 'session-def',
		};

		await handleAgentResultArtifacts(
			'issue-no-field',
			'implementation',
			agentResult,
			projectNoCostField,
		);

		expect(mockPMProvider.getCustomFieldNumber).not.toHaveBeenCalled();
		expect(mockPMProvider.updateCustomFieldNumber).not.toHaveBeenCalled();
	});

	it('skips when cost is zero', async () => {
		const agentResult: AgentResult = {
			success: true,
			cost: 0,
			sessionId: 'session-zero',
		};

		await handleAgentResultArtifacts('card-zero', 'implementation', agentResult, mockTrelloProject);

		expect(mockPMProvider.getCustomFieldNumber).not.toHaveBeenCalled();
		expect(mockPMProvider.updateCustomFieldNumber).not.toHaveBeenCalled();
	});

	it('skips when cost is undefined', async () => {
		const agentResult: AgentResult = {
			success: true,
			sessionId: 'session-undef',
		};

		await handleAgentResultArtifacts(
			'card-undef',
			'implementation',
			agentResult,
			mockTrelloProject,
		);

		expect(mockPMProvider.getCustomFieldNumber).not.toHaveBeenCalled();
		expect(mockPMProvider.updateCustomFieldNumber).not.toHaveBeenCalled();
	});

	it('uses JIRA cost field for JIRA projects', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(1.0);

		const agentResult: AgentResult = {
			success: true,
			cost: 0.5,
			sessionId: 'session-jira',
		};

		await handleAgentResultArtifacts('PROJ-123', 'implementation', agentResult, mockJiraProject);

		expect(mockPMProvider.getCustomFieldNumber).toHaveBeenCalledWith(
			'PROJ-123',
			'cf-jira-cost-456',
		);
		expect(mockPMProvider.updateCustomFieldNumber).toHaveBeenCalledWith(
			'PROJ-123',
			'cf-jira-cost-456',
			1.5,
		);
	});

	it('handles failed agent results with cost', async () => {
		mockPMProvider.getCustomFieldNumber.mockResolvedValue(0.5);

		const agentResult: AgentResult = {
			success: false,
			error: 'Something went wrong',
			cost: 0.25,
			sessionId: 'session-failed',
		};

		await handleAgentResultArtifacts('card-fail', 'implementation', agentResult, mockTrelloProject);

		expect(mockPMProvider.updateCustomFieldNumber).toHaveBeenCalledWith(
			'card-fail',
			'cf-cost-123',
			0.75,
		);
	});
});
