/**
 * Tests for the NativeToolEngine abstract base class.
 *
 * We exercise the base class through a StubEngine that implements only the
 * required abstract members without any real subprocess logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NativeToolEngine } from '../../../src/backends/shared/NativeToolEngine.js';
import type {
	AgentEngineDefinition,
	AgentEngineResult,
	AgentExecutionPlan,
} from '../../../src/backends/types.js';

// ---------------------------------------------------------------------------
// Mock cleanupContextFiles to avoid filesystem I/O in tests
// ---------------------------------------------------------------------------
vi.mock('../../../src/backends/shared/contextFiles.js', () => ({
	cleanupContextFiles: vi.fn().mockResolvedValue(undefined),
}));

import { cleanupContextFiles } from '../../../src/backends/shared/contextFiles.js';

// ---------------------------------------------------------------------------
// Mock buildEngineEnv so we can verify it is called correctly
// ---------------------------------------------------------------------------
vi.mock('../../../src/backends/shared/envBuilder.js', () => ({
	buildEngineEnv: vi.fn().mockReturnValue({ HOME: '/test', PATH: '/usr/bin' }),
}));

import { buildEngineEnv } from '../../../src/backends/shared/envBuilder.js';

// ---------------------------------------------------------------------------
// StubEngine — minimal concrete subclass for testing the base class
// ---------------------------------------------------------------------------

const STUB_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'stub',
	label: 'Stub Engine',
	description: 'Test stub — not a real engine.',
	archetype: 'native-tool',
	capabilities: ['native_file_edit_tools'],
	modelSelection: { type: 'free-text' },
	logLabel: 'Stub Log',
};

class StubEngine extends NativeToolEngine {
	readonly definition = STUB_ENGINE_DEFINITION;

	getAllowedEnvExact(): Set<string> {
		return new Set(['STUB_API_KEY']);
	}

	getExtraEnvVars(): Record<string, string> {
		return { CI: 'true', STUB_FLAG: '1' };
	}

	resolveEngineModel(cascadeModel: string): string {
		if (cascadeModel === 'stub:v1') return 'stub-v1';
		throw new Error(`Incompatible model: ${cascadeModel}`);
	}

	// Expose protected resolveSettings for testing
	resolveSettingsPublic<S extends z.ZodType<Record<string, unknown>>>(
		input: AgentExecutionPlan,
		schema: S,
	): z.infer<S> {
		return this.resolveSettings(input, schema);
	}

	// Simple stub: always returns a successful result
	async execute(_input: AgentExecutionPlan): Promise<AgentEngineResult> {
		return { success: true, output: 'stub output' };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalPlan(overrides?: Partial<AgentExecutionPlan>): AgentExecutionPlan {
	return {
		agentType: 'implementation',
		project: {
			id: 'test-project',
			orgId: 'org-1',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			pm: { type: 'trello' },
		} as AgentExecutionPlan['project'],
		config: {} as AgentExecutionPlan['config'],
		repoDir: '/tmp/test-repo',
		agentInput: {} as AgentExecutionPlan['agentInput'],
		progressReporter: {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onText: vi.fn(),
			onToolCall: vi.fn(),
		},
		logWriter: vi.fn(),
		systemPrompt: 'You are a helpful assistant.',
		taskPrompt: 'Do the task.',
		availableTools: [],
		contextInjections: [],
		maxIterations: 10,
		model: 'stub:v1',
		cliToolsDir: '/usr/local/cascade-tools',
		...overrides,
	} as AgentExecutionPlan;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NativeToolEngine (via StubEngine)', () => {
	let engine: StubEngine;

	beforeEach(() => {
		engine = new StubEngine();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// definition
	// -------------------------------------------------------------------------
	describe('definition', () => {
		it('exposes the definition from the subclass', () => {
			expect(engine.definition).toBe(STUB_ENGINE_DEFINITION);
		});

		it('has archetype = native-tool', () => {
			expect(engine.definition.archetype).toBe('native-tool');
		});
	});

	// -------------------------------------------------------------------------
	// supportsAgentType
	// -------------------------------------------------------------------------
	describe('supportsAgentType', () => {
		it('returns true for any agent type', () => {
			expect(engine.supportsAgentType('implementation')).toBe(true);
			expect(engine.supportsAgentType('review')).toBe(true);
			expect(engine.supportsAgentType('splitting')).toBe(true);
			expect(engine.supportsAgentType('some-unknown-agent')).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// resolveModel — delegates to resolveEngineModel
	// -------------------------------------------------------------------------
	describe('resolveModel', () => {
		it('returns the engine-specific model string for a compatible model', () => {
			expect(engine.resolveModel('stub:v1')).toBe('stub-v1');
		});

		it('throws for an incompatible model', () => {
			expect(() => engine.resolveModel('claude-3-5-sonnet')).toThrow('Incompatible model');
		});
	});

	// -------------------------------------------------------------------------
	// buildEnv — calls buildEngineEnv with the right arguments
	// -------------------------------------------------------------------------
	describe('buildEnv', () => {
		it('calls buildEngineEnv with allowedEnvExact from getAllowedEnvExact()', () => {
			engine.buildEnv();

			expect(buildEngineEnv).toHaveBeenCalledWith(
				expect.objectContaining({
					allowedEnvExact: new Set(['STUB_API_KEY']),
				}),
			);
		});

		it('calls buildEngineEnv with extraVars from getExtraEnvVars()', () => {
			engine.buildEnv();

			expect(buildEngineEnv).toHaveBeenCalledWith(
				expect.objectContaining({
					extraVars: { CI: 'true', STUB_FLAG: '1' },
				}),
			);
		});

		it('passes projectSecrets through to buildEngineEnv', () => {
			const secrets = { STUB_API_KEY: 'key-value' };
			engine.buildEnv(secrets);

			expect(buildEngineEnv).toHaveBeenCalledWith(
				expect.objectContaining({ projectSecrets: secrets }),
			);
		});

		it('passes cliToolsDir through to buildEngineEnv', () => {
			engine.buildEnv(undefined, '/usr/local/cascade-tools');

			expect(buildEngineEnv).toHaveBeenCalledWith(
				expect.objectContaining({ cliToolsDir: '/usr/local/cascade-tools' }),
			);
		});

		it('passes nativeToolShimDir through to buildEngineEnv', () => {
			engine.buildEnv(undefined, undefined, '/tmp/shims');

			expect(buildEngineEnv).toHaveBeenCalledWith(
				expect.objectContaining({ nativeToolShimDir: '/tmp/shims' }),
			);
		});

		it('returns the env record produced by buildEngineEnv', () => {
			vi.mocked(buildEngineEnv).mockReturnValueOnce({ HOME: '/test', PATH: '/usr/bin' });
			const env = engine.buildEnv();
			expect(env).toEqual({ HOME: '/test', PATH: '/usr/bin' });
		});
	});

	// -------------------------------------------------------------------------
	// afterExecute — calls cleanupContextFiles
	// -------------------------------------------------------------------------
	describe('afterExecute', () => {
		it('calls cleanupContextFiles with the plan repoDir', async () => {
			const plan = makeMinimalPlan({ repoDir: '/tmp/test-repo' });
			const result: AgentEngineResult = { success: true, output: '' };

			await engine.afterExecute(plan, result);

			expect(cleanupContextFiles).toHaveBeenCalledWith('/tmp/test-repo');
		});

		it('resolves without throwing when cleanupContextFiles succeeds', async () => {
			const plan = makeMinimalPlan();
			const result: AgentEngineResult = { success: true, output: '' };

			await expect(engine.afterExecute(plan, result)).resolves.toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// execute — delegated to subclass
	// -------------------------------------------------------------------------
	describe('execute', () => {
		it('returns the result from the subclass execute implementation', async () => {
			const plan = makeMinimalPlan();
			const result = await engine.execute(plan);
			expect(result).toEqual({ success: true, output: 'stub output' });
		});
	});

	// -------------------------------------------------------------------------
	// resolveSettings — reads engine settings from the execution plan
	// -------------------------------------------------------------------------
	describe('resolveSettings', () => {
		const StubSchema = z.object({
			timeout: z.number().optional(),
			mode: z.string().optional(),
		});

		it('returns {} when no engineSettings or project.engineSettings are set', () => {
			const plan = makeMinimalPlan();
			const result = engine.resolveSettingsPublic(plan, StubSchema);
			expect(result).toEqual({});
		});

		it('returns settings from project.engineSettings when input.engineSettings is absent', () => {
			const plan = makeMinimalPlan({
				project: {
					id: 'test-project',
					orgId: 'org-1',
					name: 'Test',
					repo: 'owner/repo',
					baseBranch: 'main',
					branchPrefix: 'feature/',
					pm: { type: 'trello' },
					engineSettings: { stub: { timeout: 5000, mode: 'fast' } },
				} as AgentExecutionPlan['project'],
			});
			const result = engine.resolveSettingsPublic(plan, StubSchema);
			expect(result).toEqual({ timeout: 5000, mode: 'fast' });
		});

		it('prefers input.engineSettings over project.engineSettings', () => {
			const plan = makeMinimalPlan({
				project: {
					id: 'test-project',
					orgId: 'org-1',
					name: 'Test',
					repo: 'owner/repo',
					baseBranch: 'main',
					branchPrefix: 'feature/',
					pm: { type: 'trello' },
					engineSettings: { stub: { timeout: 1000 } },
				} as AgentExecutionPlan['project'],
				engineSettings: { stub: { timeout: 9999 } },
			});
			const result = engine.resolveSettingsPublic(plan, StubSchema);
			expect(result).toEqual({ timeout: 9999 });
		});

		it('returns {} when engineSettings exists but has no entry for this engine id', () => {
			const plan = makeMinimalPlan({
				engineSettings: { 'other-engine': { timeout: 5000 } },
			});
			const result = engine.resolveSettingsPublic(plan, StubSchema);
			expect(result).toEqual({});
		});

		it('uses definition.id ("stub") as the engine settings key', () => {
			const plan = makeMinimalPlan({
				engineSettings: { stub: { timeout: 42 } },
			});
			const result = engine.resolveSettingsPublic(plan, StubSchema);
			expect(result.timeout).toBe(42);
		});
	});

	// -------------------------------------------------------------------------
	// implements AgentEngine interface
	// -------------------------------------------------------------------------
	describe('AgentEngine interface conformance', () => {
		it('has a definition property', () => {
			expect(engine.definition).toBeDefined();
		});

		it('has an execute function', () => {
			expect(typeof engine.execute).toBe('function');
		});

		it('has a supportsAgentType function', () => {
			expect(typeof engine.supportsAgentType).toBe('function');
		});

		it('has a resolveModel function', () => {
			expect(typeof engine.resolveModel).toBe('function');
		});

		it('has an afterExecute function', () => {
			expect(typeof engine.afterExecute).toBe('function');
		});
	});
});
