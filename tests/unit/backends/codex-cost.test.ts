/**
 * Cost & token accounting tests for the Codex engine.
 *
 * These tests pin three invariants that previously broke:
 *
 *   1. usage on turn.completed is CUMULATIVE across the session — per-turn
 *      rows must store DELTAS, not running totals (upstream openai/codex#17539).
 *   2. cost is computed CASCADE-side from per-turn token deltas × the
 *      pricing table in src/utils/llmMetrics.ts. Codex never emits cost_usd
 *      in its JSONL stream; any cost_usd-shaped field is ignored.
 *   3. context.cost (returned in AgentEngineResult.cost) accumulates
 *      additively across turns — overwriting per turn was the original bug.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
const mockWriteProjectCredential = vi.fn<() => Promise<void>>();
const mockWriteFile = vi.fn<() => Promise<void>>();
const mockMkdir = vi.fn<() => Promise<void>>();
const mockReadFile = vi.fn<() => Promise<string>>();

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('node:fs/promises', () => ({
	mkdir: (...args: unknown[]) => mockMkdir(...args),
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	writeProjectCredential: (...args: unknown[]) => mockWriteProjectCredential(...args),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { CodexEngine } from '../../../src/backends/codex/index.js';
import { DEFAULT_CODEX_MODEL } from '../../../src/backends/codex/models.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';
import { calculateCost } from '../../../src/utils/llmMetrics.js';

function makeInput(overrides: Partial<AgentExecutionPlan> = {}): AgentExecutionPlan {
	return {
		agentType: 'implementation',
		project: {
			id: 'test-project',
			orgId: 'org-1',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			pm: { type: 'trello' },
			trello: { boardId: 'b1', lists: {}, labels: {} },
			engineSettings: undefined,
		},
		config: { projects: [] },
		repoDir: '/tmp/repo',
		systemPrompt: 'You are an agent.',
		taskPrompt: 'Implement feature X.',
		cliToolsDir: '/usr/bin',
		availableTools: [],
		contextInjections: [],
		maxIterations: 20,
		budgetUsd: 5,
		model: DEFAULT_CODEX_MODEL,
		nativeToolCapabilities: ['fs:read', 'fs:write', 'shell:exec'],
		progressReporter: {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onToolCall: vi.fn(),
			onText: vi.fn(),
		},
		logWriter: vi.fn(),
		agentInput: { workItemId: 'card-1' },
		projectSecrets: { OPENAI_API_KEY: 'sk-test' },
		engineLogPath: undefined,
		...overrides,
	};
}

function createMockChild({
	stdoutLines = [],
	stderr = '',
	exitCode = 0,
	onBeforeClose,
}: {
	stdoutLines?: string[];
	stderr?: string;
	exitCode?: number;
	onBeforeClose?: () => void;
}) {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		stdin: PassThrough;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.stdin = new PassThrough();

	queueMicrotask(() => {
		for (const line of stdoutLines) child.stdout.write(`${line}\n`);
		if (stderr) child.stderr.write(stderr);
		onBeforeClose?.();
		child.stdout.end();
		child.stderr.end();
		child.emit('close', exitCode);
	});

	return child;
}

function stdoutFor(events: object[]): string[] {
	return events.map((e) => JSON.stringify(e));
}

describe('CodexEngine — cost and token deltas', () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-cost-test-'));
		mockStoreLlmCall.mockClear();
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockWriteProjectCredential.mockResolvedValue(undefined);
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
	});

	// ─── Test 1: single-turn ──────────────────────────────────────────────────

	it('persists one row with delta tokens and computed cost on a single-turn run', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{
						type: 'turn.completed',
						usage: { input_tokens: 1000, output_tokens: 500 },
					},
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Finished.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			engineLogPath: join(workspaceDir, 'codex.log'),
			runId: 'run-single',
		});

		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
		const [call] = mockStoreLlmCall.mock.calls[0];
		expect(call.inputTokens).toBe(1000);
		expect(call.outputTokens).toBe(500);
		expect(call.costUsd).toBeGreaterThan(0);

		const expected = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 1000,
			outputTokens: 500,
		});
		expect(call.costUsd).toBeCloseTo(expected, 6);
		expect(result.cost).toBeCloseTo(expected, 6);
	});

	// ─── Test 2: three-turn cumulative → delta ────────────────────────────────

	it('converts cumulative session usage into per-turn deltas across multiple turns', async () => {
		// Upstream codex emits cumulative session totals on each turn.completed.
		// CASCADE must persist DELTAS, not the running totals.
		// Cumulative: turn 1 → {1000,500}, turn 2 → {2500,1100}, turn 3 → {4000,1800}
		// Deltas:     turn 1 → {1000,500}, turn 2 → {1500,600}, turn 3 → {1500,700}
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 500 } },
					{ type: 'turn.started' },
					{ type: 'turn.completed', usage: { input_tokens: 2500, output_tokens: 1100 } },
					{ type: 'turn.started' },
					{ type: 'turn.completed', usage: { input_tokens: 4000, output_tokens: 1800 } },
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const result = await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-multi',
			}),
		);

		expect(result.success).toBe(true);
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(3);

		const rows = mockStoreLlmCall.mock.calls.map((c) => c[0]);
		expect(rows[0].inputTokens).toBe(1000);
		expect(rows[0].outputTokens).toBe(500);
		expect(rows[1].inputTokens).toBe(1500);
		expect(rows[1].outputTokens).toBe(600);
		expect(rows[2].inputTokens).toBe(1500);
		expect(rows[2].outputTokens).toBe(700);

		// result.cost = sum of per-turn deltas priced individually.
		// (Equivalently, since pricing is linear, it should equal the cost of the
		// final cumulative — this asserts the additive accumulator is correct.)
		const expectedTotal = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 4000,
			outputTokens: 1800,
		});
		expect(result.cost).toBeCloseTo(expectedTotal, 6);
	});

	// ─── Test 3: reasoning tokens ─────────────────────────────────────────────

	it('uses output_tokens as-is for billing — reasoning_output_tokens is a subset, not extra', async () => {
		// OpenAI/Codex: reasoning_output_tokens is a BREAKDOWN of output_tokens,
		// not an additional counter. A turn with output_tokens: 1000 and
		// reasoning_output_tokens: 800 has 1000 total output tokens (800 of which
		// are internal reasoning). Billing uses output_tokens (1000) directly;
		// adding reasoning on top would over-count to 1800.
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{
						type: 'turn.completed',
						usage: {
							input_tokens: 100,
							output_tokens: 1000,
							reasoning_output_tokens: 800, // subset of the 1000 output tokens
						},
					},
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const result = await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-reasoning',
			}),
		);

		const [row] = mockStoreLlmCall.mock.calls[0];
		// Cost uses output_tokens (1000) directly — NOT output + reasoning (1800).
		const expected = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 100,
			outputTokens: 1000,
		});
		expect(row.outputTokens).toBe(1000); // not 1800
		expect(row.costUsd).toBeCloseTo(expected, 6);
		expect(result.cost).toBeCloseTo(expected, 6);
		// Reasoning breakdown is preserved in the stored response JSON for observability.
		const response = JSON.parse(row.response);
		expect(response.reasoning).toBe(800);
		expect(response.delta.outputTokens).toBe(1000);
		expect(response.delta.reasoningTokens).toBe(800);
	});

	// ─── Test 4: cached input ─────────────────────────────────────────────────

	it('applies cached-input discount when cached_input_tokens are present', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{
						type: 'turn.completed',
						usage: { input_tokens: 1000, output_tokens: 0, cached_input_tokens: 800 },
					},
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const result = await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-cached',
			}),
		);

		const expected = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 1000,
			outputTokens: 0,
			cachedInputTokens: 800,
		});
		const noCacheCost = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 1000,
			outputTokens: 0,
		});
		expect(result.cost).toBeCloseTo(expected, 6);
		expect(expected).toBeLessThan(noCacheCost);
	});

	// ─── Test 5: out-of-order event (defensive clamp) ─────────────────────────

	it('clamps deltas to zero when cumulative usage goes backwards (out-of-order event)', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 500 } },
					{ type: 'turn.started' },
					// Lower cumulative — should be clamped, not produce negative tokens.
					{ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 400 } },
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-out-of-order',
			}),
		);

		const rows = mockStoreLlmCall.mock.calls.map((c) => c[0]);
		expect(rows).toHaveLength(2);
		expect(rows[1].inputTokens).toBe(0);
		expect(rows[1].outputTokens).toBe(0);
	});

	// ─── Test 5b: mixed regression — one counter up, one down ─────────────────

	it('returns all-zero delta when any single counter regresses — prevents double-counting', async () => {
		// Regression test for the bug where computeTurnDelta returned per-field
		// Math.max(0, curr-prev) even when the backwards guard tripped. If inputTokens
		// went backwards while outputTokens increased, the positive outputTokens delta
		// was still persisted AND double-counted on the next valid event (because the
		// high-water mark was not advanced for the rejected event).
		//
		// Scenario: T1 valid {1000,500} → T2 mixed {900,600} → T3 valid {2000,1200}
		// Expected:
		//   T1 delta: {1000, 500}  (first event, HWM=0→{1000,500})
		//   T2 delta: {0, 0}       (inputTokens regressed — whole event discarded)
		//   T3 delta: {1000, 700}  (2000-1000, 1200-500 from unchanged HWM)
		// Bug produced T2 delta {0, 100} which was then double-counted in T3.
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					// T1: valid baseline
					{ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 500 } },
					{ type: 'turn.started' },
					// T2: inputTokens goes backwards (1000→900), outputTokens increases (500→600)
					{ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 600 } },
					{ type: 'turn.started' },
					// T3: both counters advance from valid T1 baseline (HWM was not advanced for T2)
					{ type: 'turn.completed', usage: { input_tokens: 2000, output_tokens: 1200 } },
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-mixed-regression',
			}),
		);

		const rows = mockStoreLlmCall.mock.calls.map((c) => c[0]);
		expect(rows).toHaveLength(3);

		// T1: valid delta
		expect(rows[0].inputTokens).toBe(1000);
		expect(rows[0].outputTokens).toBe(500);

		// T2: all-zero delta — whole event discarded because inputTokens regressed
		// (was {0, 100} before the fix — outputTokens was charged even though the
		// event was invalid, and would be double-counted in T3)
		expect(rows[1].inputTokens).toBe(0);
		expect(rows[1].outputTokens).toBe(0); // NOT 100
		expect(rows[1].costUsd).toBeUndefined();

		// T3: delta computed from the unchanged HWM {1000, 500}
		// → {2000-1000, 1200-500} = {1000, 700}
		expect(rows[2].inputTokens).toBe(1000);
		expect(rows[2].outputTokens).toBe(700);
	});

	// ─── Test 6: no usage on turn.completed ───────────────────────────────────

	it('persists a row with undefined token fields when turn.completed carries no usage', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([{ type: 'turn.started' }, { type: 'turn.completed' }]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const result = await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-no-usage',
			}),
		);

		expect(result.success).toBe(true);
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
		const [row] = mockStoreLlmCall.mock.calls[0];
		expect(row.inputTokens).toBeUndefined();
		expect(row.outputTokens).toBeUndefined();
		expect(row.costUsd).toBeUndefined();
		expect(result.cost).toBeUndefined();
	});

	// ─── Test 7: smuggled cost_usd field is ignored (no-rug-sweep) ────────────

	it('ignores any cost_usd field on the event — cost always derives from tokens', async () => {
		// Upstream codex doesn't emit cost_usd, but if a future version (or a
		// malformed event) smuggles one in, we MUST compute from tokens and
		// ignore the smuggled value. Pins the "delete dead branches" decision.
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					{
						type: 'turn.completed',
						usage: { input_tokens: 100, output_tokens: 50 },
						total_cost_usd: 999, // ← smuggled value; must be ignored
						cost_usd: 999, // ← also ignored
					},
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const result = await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-smuggled',
			}),
		);

		const expected = calculateCost(`openai:${DEFAULT_CODEX_MODEL}`, {
			inputTokens: 100,
			outputTokens: 50,
		});
		expect(result.cost).toBeCloseTo(expected, 6);
		expect(result.cost).toBeLessThan(1); // certainly not 999
	});

	// ─── Test 8: response.completed intermediate event does not persist ──────

	it('accumulates intermediate response.completed usage but persists only on turn.completed', async () => {
		// Pins the existing invariant: exactly one row per turn, not per usage event.
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: stdoutFor([
					{ type: 'turn.started' },
					// Intermediate usage — should NOT persist a row.
					{
						type: 'response.completed',
						response: { usage: { input_tokens: 50, output_tokens: 20 } },
					},
					// Final usage (cumulative session total at end of turn).
					{
						type: 'turn.completed',
						usage: { input_tokens: 100, output_tokens: 40 },
					},
				]),
				onBeforeClose: () => writeFileSync(outputPath, 'Done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		await engine.execute(
			makeInput({
				repoDir: workspaceDir,
				engineLogPath: join(workspaceDir, 'codex.log'),
				runId: 'run-intermediate',
			}),
		);

		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
		const [row] = mockStoreLlmCall.mock.calls[0];
		expect(row.inputTokens).toBe(100);
		expect(row.outputTokens).toBe(40);
	});
});
