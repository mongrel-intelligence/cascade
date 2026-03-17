import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import RunsCancel from '../../../../../src/cli/dashboard/runs/cancel.js';
import RunsDebug from '../../../../../src/cli/dashboard/runs/debug.js';
import RunsList from '../../../../../src/cli/dashboard/runs/list.js';
import RunsLlmCall from '../../../../../src/cli/dashboard/runs/llm-call.js';
import RunsLlmCalls from '../../../../../src/cli/dashboard/runs/llm-calls.js';
import RunsLogs from '../../../../../src/cli/dashboard/runs/logs.js';
import RunsRetry from '../../../../../src/cli/dashboard/runs/retry.js';
import RunsShow from '../../../../../src/cli/dashboard/runs/show.js';
import RunsTrigger from '../../../../../src/cli/dashboard/runs/trigger.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		runs: {
			list: { query: vi.fn().mockResolvedValue({ data: [], total: 0 }) },
			getById: { query: vi.fn().mockResolvedValue({}) },
			getLogs: { query: vi.fn().mockResolvedValue([]) },
			listLlmCalls: { query: vi.fn().mockResolvedValue([]) },
			getLlmCall: { query: vi.fn().mockResolvedValue({}) },
			getDebugAnalysis: { query: vi.fn().mockResolvedValue(null) },
			getDebugAnalysisStatus: { query: vi.fn().mockResolvedValue({ status: 'idle' }) },
			triggerDebugAnalysis: { mutate: vi.fn().mockResolvedValue({ runId: 'run-abc' }) },
			trigger: { mutate: vi.fn().mockResolvedValue({ runId: 'run-abc' }) },
			retry: { mutate: vi.fn().mockResolvedValue({ runId: 'run-abc' }) },
			cancel: { mutate: vi.fn().mockResolvedValue({ runId: 'run-abc' }) },
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ─── runs list ────────────────────────────────────────────────────────────────

describe('RunsList (runs list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes all filter flags to tRPC query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsList(
			[
				'--project',
				'my-project',
				'--status',
				'running,failed',
				'--agent-type',
				'implementation',
				'--limit',
				'10',
				'--offset',
				'5',
				'--sort',
				'durationMs',
				'--order',
				'asc',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.runs.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			status: ['running', 'failed'],
			agentType: 'implementation',
			limit: 10,
			offset: 5,
			sort: 'durationMs',
			order: 'asc',
		});
	});

	it('uses default values when no flags provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsList([], oclifConfig as never);
		await cmd.run();

		expect(client.runs.list.query).toHaveBeenCalledWith({
			projectId: undefined,
			status: undefined,
			agentType: undefined,
			limit: 50,
			offset: 0,
			sort: 'startedAt',
			order: 'desc',
		});
	});

	it('shows pagination message when total exceeds displayed count', async () => {
		const client = makeClient();
		(client.runs.list.query as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [{ id: 'run-1' }, { id: 'run-2' }],
			total: 100,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsList([], oclifConfig as never);
			// Override log to capture output
			const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');
			await cmd.run();
			// Should call this.log with pagination message
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 of 100'));
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('does not show pagination message when total equals displayed count', async () => {
		const client = makeClient();
		(client.runs.list.query as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [{ id: 'run-1' }],
			total: 1,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsList([], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');
		await cmd.run();

		// log should not be called with pagination message
		const paginationCalls = logSpy.mock.calls.filter((c) => String(c[0]).includes('of'));
		expect(paginationCalls).toHaveLength(0);
	});

	it('outputs empty result message when no runs found', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsList([], oclifConfig as never);
		// Just ensure it doesn't throw
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ─── runs show ────────────────────────────────────────────────────────────────

describe('RunsShow (runs show)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID to getById query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsShow(['run-uuid-123'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.getById.query).toHaveBeenCalledWith({ id: 'run-uuid-123' });
	});

	it('outputs JSON when --json flag is set', async () => {
		const runData = { id: 'run-uuid-123', status: 'completed', agentType: 'implementation' };
		const client = makeClient();
		(client.runs.getById.query as ReturnType<typeof vi.fn>).mockResolvedValue(runData);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsShow(['run-uuid-123', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(runData, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs logs ────────────────────────────────────────────────────────────────

describe('RunsLogs (runs logs)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID to getLogs query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsLogs(['run-uuid-456'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.getLogs.query).toHaveBeenCalledWith({ runId: 'run-uuid-456' });
	});

	it('outputs log content for string logs', async () => {
		const client = makeClient();
		(client.runs.getLogs.query as ReturnType<typeof vi.fn>).mockResolvedValue(
			'log line 1\nlog line 2',
		);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsLogs(['run-uuid-456'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith('log line 1\nlog line 2');
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('outputs each entry for array logs', async () => {
		const client = makeClient();
		(client.runs.getLogs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
			'entry one',
			'entry two',
		]);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsLogs(['run-uuid-456'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith('entry one');
			expect(consoleSpy).toHaveBeenCalledWith('entry two');
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('shows "No logs found" when empty', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsLogs(['run-uuid-456'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');
		await cmd.run();

		expect(logSpy).toHaveBeenCalledWith('No logs found.');
	});
});

// ─── runs llm-calls ───────────────────────────────────────────────────────────

describe('RunsLlmCalls (runs llm-calls)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID to listLlmCalls query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsLlmCalls(['run-uuid-789'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.listLlmCalls.query).toHaveBeenCalledWith({ runId: 'run-uuid-789' });
	});

	it('outputs JSON when --json flag is set', async () => {
		const llmCalls = [{ callNumber: 1, model: 'claude-3' }];
		const client = makeClient();
		(client.runs.listLlmCalls.query as ReturnType<typeof vi.fn>).mockResolvedValue(llmCalls);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsLlmCalls(['run-uuid-789', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(llmCalls, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs llm-call ────────────────────────────────────────────────────────────

describe('RunsLlmCall (runs llm-call)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID and call number to getLlmCall query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsLlmCall(['run-uuid-abc', '3'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.getLlmCall.query).toHaveBeenCalledWith({
			runId: 'run-uuid-abc',
			callNumber: 3,
		});
	});

	it('outputs JSON when --json flag is set', async () => {
		const llmCall = { callNumber: 3, model: 'claude-3', inputTokens: 100 };
		const client = makeClient();
		(client.runs.getLlmCall.query as ReturnType<typeof vi.fn>).mockResolvedValue(llmCall);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsLlmCall(['run-uuid-abc', '3', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(llmCall, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs debug (show) ────────────────────────────────────────────────────────

describe('RunsDebug show (runs debug)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('fetches debug analysis for the run', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsDebug(['run-uuid-dbg'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.getDebugAnalysis.query).toHaveBeenCalledWith({ runId: 'run-uuid-dbg' });
	});

	it('shows helpful message when analysis is null', async () => {
		const client = makeClient();
		(client.runs.getDebugAnalysis.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsDebug(['run-uuid-dbg'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');
		await cmd.run();

		expect(logSpy).toHaveBeenCalledWith(
			'No debug analysis found for this run. Use --analyze to trigger one.',
		);
	});

	it('outputs JSON when --json flag is set and analysis exists', async () => {
		const analysis = { summary: 'All good', issues: [] };
		const client = makeClient();
		(client.runs.getDebugAnalysis.query as ReturnType<typeof vi.fn>).mockResolvedValue(analysis);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsDebug(['run-uuid-dbg', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(analysis, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('outputs JSON null when --json flag is set and analysis is null', async () => {
		const client = makeClient();
		(client.runs.getDebugAnalysis.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsDebug(['run-uuid-dbg', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(null, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs debug (trigger, no wait) ───────────────────────────────────────────

describe('RunsDebug trigger without wait (runs debug --analyze)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('triggers debug analysis without waiting', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsDebug(['run-uuid-dbg', '--analyze'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');
		await cmd.run();

		expect(client.runs.triggerDebugAnalysis.mutate).toHaveBeenCalledWith({
			runId: 'run-uuid-dbg',
		});
		// Should not poll
		expect(client.runs.getDebugAnalysisStatus.query).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith('Debug analysis triggered.');
	});

	it('outputs JSON result when --analyze --json', async () => {
		const triggerResult = { runId: 'run-uuid-dbg', status: 'queued' };
		const client = makeClient();
		(client.runs.triggerDebugAnalysis.mutate as ReturnType<typeof vi.fn>).mockResolvedValue(
			triggerResult,
		);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsDebug(['run-uuid-dbg', '--analyze', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(triggerResult, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs debug (trigger + wait, polling) ────────────────────────────────────

describe('RunsDebug trigger with wait (runs debug --analyze --wait)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('polls getDebugAnalysisStatus until completed', async () => {
		const analysis = { summary: 'Done', issues: [] };
		const client = makeClient();
		const statusQuery = client.runs.getDebugAnalysisStatus.query as ReturnType<typeof vi.fn>;
		statusQuery
			.mockResolvedValueOnce({ status: 'running' })
			.mockResolvedValueOnce({ status: 'running' })
			.mockResolvedValueOnce({ status: 'completed' });
		(client.runs.getDebugAnalysis.query as ReturnType<typeof vi.fn>).mockResolvedValue(analysis);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const cmd = new RunsDebug(['run-uuid-dbg', '--analyze', '--wait'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');

		const runPromise = cmd.run();

		// Advance timers for each poll cycle (5000ms per poll)
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(5000);

		await runPromise;

		expect(statusQuery).toHaveBeenCalledTimes(3);
		expect(logSpy).toHaveBeenCalledWith('Debug analysis completed.');
		expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(analysis, null, 2));
		consoleSpy.mockRestore();
	});

	it('stops polling when status is idle', async () => {
		const client = makeClient();
		const statusQuery = client.runs.getDebugAnalysisStatus.query as ReturnType<typeof vi.fn>;
		statusQuery.mockResolvedValue({ status: 'idle' });
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsDebug(['run-uuid-dbg', '--analyze', '--wait'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');

		const runPromise = cmd.run();
		await vi.advanceTimersByTimeAsync(5000);
		await runPromise;

		expect(logSpy).toHaveBeenCalledWith(
			'Debug analysis finished but no result was stored (analysis may have failed).',
		);
	});

	it('logs timeout message after 5-minute deadline', async () => {
		const client = makeClient();
		const statusQuery = client.runs.getDebugAnalysisStatus.query as ReturnType<typeof vi.fn>;
		// Always return running to trigger timeout
		statusQuery.mockResolvedValue({ status: 'running' });
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsDebug(['run-uuid-dbg', '--analyze', '--wait'], oclifConfig as never);
		const logSpy = vi.spyOn(cmd as unknown as { log: (s: string) => void }, 'log');

		const runPromise = cmd.run();

		// Advance past the 5-minute (300000ms) deadline — advance in chunks matching poll interval
		for (let i = 0; i < 61; i++) {
			await vi.advanceTimersByTimeAsync(5000);
		}

		await runPromise;

		expect(logSpy).toHaveBeenCalledWith('Timed out waiting for debug analysis to complete.');
	});
});

// ─── runs trigger ─────────────────────────────────────────────────────────────

describe('RunsTrigger (runs trigger)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project and agent-type to tRPC mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsTrigger(
			['--project', 'proj-abc', '--agent-type', 'implementation'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.runs.trigger.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-abc',
				agentType: 'implementation',
			}),
		);
	});

	it('passes optional work-item-id and model flags', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsTrigger(
			[
				'--project',
				'proj-abc',
				'--agent-type',
				'implementation',
				'--work-item-id',
				'card-xyz',
				'--model',
				'claude-opus-4-5',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.runs.trigger.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-abc',
				agentType: 'implementation',
				workItemId: 'card-xyz',
				model: 'claude-opus-4-5',
			}),
		);
	});

	it('requires --project and --agent-type flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new RunsTrigger([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('outputs JSON result when --json flag is set', async () => {
		const result = { runId: 'new-run-id' };
		const client = makeClient();
		(client.runs.trigger.mutate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsTrigger(
				['--project', 'proj-abc', '--agent-type', 'implementation', '--json'],
				oclifConfig as never,
			);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs retry ───────────────────────────────────────────────────────────────

describe('RunsRetry (runs retry)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID to retry mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsRetry(['run-uuid-ret'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.retry.mutate).toHaveBeenCalledWith({
			runId: 'run-uuid-ret',
			model: undefined,
		});
	});

	it('passes optional model override to retry mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsRetry(['run-uuid-ret', '--model', 'claude-opus-4-5'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.retry.mutate).toHaveBeenCalledWith({
			runId: 'run-uuid-ret',
			model: 'claude-opus-4-5',
		});
	});

	it('outputs JSON result when --json flag is set', async () => {
		const result = { runId: 'run-uuid-ret', status: 'queued' };
		const client = makeClient();
		(client.runs.retry.mutate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsRetry(['run-uuid-ret', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

// ─── runs cancel ──────────────────────────────────────────────────────────────

describe('RunsCancel (runs cancel)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes run ID to cancel mutate with default reason', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsCancel(['run-uuid-can'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.cancel.mutate).toHaveBeenCalledWith({
			runId: 'run-uuid-can',
			reason: 'Manually cancelled via CLI',
		});
	});

	it('passes optional custom reason to cancel mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new RunsCancel(['run-uuid-can', '--reason', 'too slow'], oclifConfig as never);
		await cmd.run();

		expect(client.runs.cancel.mutate).toHaveBeenCalledWith({
			runId: 'run-uuid-can',
			reason: 'too slow',
		});
	});

	it('outputs JSON result when --json flag is set', async () => {
		const result = { runId: 'run-uuid-can', status: 'cancelled' };
		const client = makeClient();
		(client.runs.cancel.mutate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
		mockCreateDashboardClient.mockReturnValue(client);

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const cmd = new RunsCancel(['run-uuid-can', '--json'], oclifConfig as never);
			await cmd.run();
			expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
		} finally {
			consoleSpy.mockRestore();
		}
	});
});
