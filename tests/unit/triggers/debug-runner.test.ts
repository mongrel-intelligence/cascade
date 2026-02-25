import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunById: vi.fn(),
	getRunLogs: vi.fn(),
	getLlmCallsByRunId: vi.fn(),
	storeDebugAnalysis: vi.fn(),
}));

vi.mock('../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/utils/repo.js', () => ({
	cleanupTempDir: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-status.js', () => ({
	markAnalysisRunning: vi.fn(),
	markAnalysisComplete: vi.fn(),
}));

import { runAgent } from '../../../src/agents/registry.js';
import {
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	storeDebugAnalysis,
} from '../../../src/db/repositories/runsRepository.js';
import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProvider } from '../../../src/pm/index.js';
import { triggerDebugAnalysis } from '../../../src/triggers/shared/debug-runner.js';
import {
	markAnalysisComplete,
	markAnalysisRunning,
} from '../../../src/triggers/shared/debug-status.js';

const mockPMProvider = { addComment: vi.fn() };
import type { CascadeConfig } from '../../../src/types/index.js';
import { createMockProject } from '../../helpers/factories.js';

const mockProject = createMockProject({ id: 'test-project' });

const mockConfig = {} as CascadeConfig;

describe('triggerDebugAnalysis', () => {
	beforeEach(() => {
		vi.mocked(getPMProvider).mockReturnValue(mockPMProvider as unknown as PMProvider);
	});

	it('returns early when run is not found', async () => {
		vi.mocked(getRunById).mockResolvedValue(null);

		await triggerDebugAnalysis('run-1', mockProject, mockConfig, 'card-1');

		expect(runAgent).not.toHaveBeenCalled();
	});

	it('extracts logs, runs debug agent, stores analysis, and posts comment', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue({
			cascadeLog: 'cascade log content',
			llmistLog: 'llmist log content',
		} as ReturnType<typeof getRunLogs> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output:
				'## Executive Summary\nThe agent failed.\n\n## Key Issues\nIssue 1\n\n## Root Cause\nMissing config\n',
			runId: 'debug-run-1',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-1');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig, 'card-1');

		// Should call runAgent with debug type
		expect(runAgent).toHaveBeenCalledWith(
			'debug',
			expect.objectContaining({
				originalCardId: 'card-1',
				detectedAgentType: 'implementation',
				project: mockProject,
				config: mockConfig,
			}),
		);

		// Should store analysis
		expect(storeDebugAnalysis).toHaveBeenCalledWith(
			expect.objectContaining({
				analyzedRunId: 'run-1',
				debugRunId: 'debug-run-1',
				summary: 'The agent failed.',
				issues: 'Issue 1',
				rootCause: 'Missing config',
				severity: 'failure',
			}),
		);

		// Should post Trello comment
		expect(mockPMProvider.addComment).toHaveBeenCalledWith(
			'card-1',
			expect.stringContaining('Debug Analysis'),
		);
	});

	it('sets severity to timeout for timed_out runs', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'timed_out',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '## Executive Summary\nTimeout.\n',
			runId: 'debug-run-2',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-2');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		expect(storeDebugAnalysis).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: 'timeout',
			}),
		);
	});

	it('calls markAnalysisRunning at start and markAnalysisComplete on success', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '## Executive Summary\nFailed.\n',
			runId: 'debug-run-status',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-status');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		expect(markAnalysisRunning).toHaveBeenCalledWith('run-1');
		expect(markAnalysisComplete).toHaveBeenCalledWith('run-1');
	});

	it('calls markAnalysisComplete even when agent throws', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockRejectedValue(new Error('Agent crashed'));

		await expect(triggerDebugAnalysis('run-1', mockProject, mockConfig)).rejects.toThrow(
			'Agent crashed',
		);

		expect(markAnalysisRunning).toHaveBeenCalledWith('run-1');
		expect(markAnalysisComplete).toHaveBeenCalledWith('run-1');
	});

	it('sets severity to manual for completed runs', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'completed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '## Executive Summary\nCompleted analysis.\n',
			runId: 'debug-run-manual',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-manual');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		expect(storeDebugAnalysis).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: 'manual',
			}),
		);
	});

	it('does not post comment when no cardId', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '## Executive Summary\nFailed.\n',
			runId: 'debug-run-3',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-3');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
	});

	it('writes LLM call files to temp dir', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'splitting',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue({
			cascadeLog: 'log',
			llmistLog: null,
		} as ReturnType<typeof getRunLogs> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getLlmCallsByRunId).mockResolvedValue([
			{ callNumber: 1, request: 'req1', response: 'res1' },
			{ callNumber: 2, request: 'req2', response: 'res2' },
		] as Awaited<ReturnType<typeof getLlmCallsByRunId>>);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '## Executive Summary\nAnalysis\n',
			runId: 'debug-run-4',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-4');

		// Spy on fs to verify file writes
		const writeFileSpy = vi.spyOn(fs, 'writeFileSync');
		const mkdirSpy = vi.spyOn(fs, 'mkdirSync');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		// Should have created the llm-calls directory
		expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('llm-calls'), {
			recursive: true,
		});

		// Should have written request/response files
		expect(writeFileSpy).toHaveBeenCalledWith(
			expect.stringContaining('0001.request'),
			'req1',
			'utf-8',
		);
		expect(writeFileSpy).toHaveBeenCalledWith(
			expect.stringContaining('0001.response'),
			'res1',
			'utf-8',
		);
		expect(writeFileSpy).toHaveBeenCalledWith(
			expect.stringContaining('0002.request'),
			'req2',
			'utf-8',
		);

		writeFileSpy.mockRestore();
		mkdirSpy.mockRestore();
	});
});

describe('parseDebugOutput (via triggerDebugAnalysis)', () => {
	it('parses all structured sections from markdown', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		const debugOutput = [
			'## Executive Summary',
			'The agent encountered a fatal error during PR creation.',
			'',
			'## Key Issues',
			'1. GitHub API returned 403',
			'2. Token was expired',
			'',
			'## Timeline of Events',
			'1. Started implementation',
			'2. Attempted PR creation',
			'3. Failed with 403',
			'',
			'## Root Cause',
			'The GitHub token had expired and was not refreshed.',
			'',
			'## Recommendations',
			'1. Add token refresh logic',
			'2. Add better error handling',
		].join('\n');

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: debugOutput,
			runId: 'debug-run-5',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-5');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig, 'card-1');

		expect(storeDebugAnalysis).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: 'The agent encountered a fatal error during PR creation.',
				issues: expect.stringContaining('GitHub API returned 403'),
				timeline: expect.stringContaining('Started implementation'),
				rootCause: 'The GitHub token had expired and was not refreshed.',
				recommendations: expect.stringContaining('Add token refresh logic'),
			}),
		);
	});

	it('uses output slice as summary fallback when no sections found', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(getRunLogs).mockResolvedValue(null);
		vi.mocked(getLlmCallsByRunId).mockResolvedValue([]);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Unstructured analysis without headers.',
			runId: 'debug-run-6',
		});

		vi.mocked(storeDebugAnalysis).mockResolvedValue('da-6');

		await triggerDebugAnalysis('run-1', mockProject, mockConfig);

		expect(storeDebugAnalysis).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: 'Unstructured analysis without headers.',
				issues: '',
			}),
		);
	});
});
