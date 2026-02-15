import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../src/gadgets/trello/core/readCard.js', () => ({
	readCard: vi.fn(),
}));

vi.mock('../../../src/agents/shared/repository.js', () => ({
	setupRepository: vi.fn(),
}));

vi.mock('../../../src/agents/shared/modelResolution.js', () => ({
	resolveModelConfig: vi.fn(),
}));

vi.mock('../../../src/utils/fileLogger.js', () => ({
	createFileLogger: vi.fn(),
	cleanupLogFile: vi.fn(),
	cleanupLogDirectory: vi.fn(),
}));

vi.mock('../../../src/agents/utils/logging.js', () => ({
	createAgentLogger: vi.fn(),
}));

vi.mock('../../../src/utils/cascadeEnv.js', () => ({
	loadCascadeEnv: vi.fn(),
	unloadCascadeEnv: vi.fn(),
}));

vi.mock('../../../src/utils/repo.js', () => ({
	cleanupTempDir: vi.fn(),
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	setWatchdogCleanup: vi.fn(),
	clearWatchdogCleanup: vi.fn(),
}));

vi.mock('../../../src/backends/progress.js', () => ({
	createProgressMonitor: vi.fn(),
}));

vi.mock('../../../src/config/customModels.js', () => ({
	CUSTOM_MODELS: [],
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/agents/prompts/index.js', () => ({}));

import { resolveModelConfig } from '../../../src/agents/shared/modelResolution.js';
import { setupRepository } from '../../../src/agents/shared/repository.js';
import { createAgentLogger } from '../../../src/agents/utils/logging.js';
import { executeWithBackend } from '../../../src/backends/adapter.js';
import { createProgressMonitor } from '../../../src/backends/progress.js';
import type { AgentBackend } from '../../../src/backends/types.js';
import { readCard } from '../../../src/gadgets/trello/core/readCard.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../../src/utils/cascadeEnv.js';
import {
	cleanupLogDirectory,
	cleanupLogFile,
	createFileLogger,
} from '../../../src/utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../../../src/utils/lifecycle.js';
import { logger } from '../../../src/utils/logging.js';
import { cleanupTempDir } from '../../../src/utils/repo.js';

const mockReadCard = vi.mocked(readCard);
const mockSetupRepository = vi.mocked(setupRepository);
const mockResolveModelConfig = vi.mocked(resolveModelConfig);
const mockCreateFileLogger = vi.mocked(createFileLogger);
const mockCreateAgentLogger = vi.mocked(createAgentLogger);
const mockLoadCascadeEnv = vi.mocked(loadCascadeEnv);
const mockUnloadCascadeEnv = vi.mocked(unloadCascadeEnv);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockCleanupLogFile = vi.mocked(cleanupLogFile);
const mockCleanupLogDirectory = vi.mocked(cleanupLogDirectory);
const mockClearWatchdogCleanup = vi.mocked(clearWatchdogCleanup);
const mockCreateProgressMonitor = vi.mocked(createProgressMonitor);

function makeProject(): ProjectConfig {
	return {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
	};
}

function makeConfig(): CascadeConfig {
	return {
		defaults: {
			model: 'test-model',
			agentModels: {},
			maxIterations: 50,
			agentIterations: {},
			freshMachineTimeoutMs: 300000,
			watchdogTimeoutMs: 1800000,
			postJobGracePeriodMs: 5000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'openrouter:google/gemini-2.5-flash-lite',
			progressIntervalMinutes: 5,
		},
		projects: [],
	};
}

function makeInput(
	overrides?: Partial<AgentInput>,
): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		cardId: 'card123',
		project: makeProject(),
		config: makeConfig(),
		...overrides,
	} as AgentInput & { project: ProjectConfig; config: CascadeConfig };
}

function makeMockBackend(): AgentBackend {
	return {
		name: 'test-backend',
		execute: vi.fn().mockResolvedValue({
			success: true,
			output: 'Done',
			prUrl: 'https://github.com/o/r/pull/1',
		}),
		supportsAgentType: () => true,
	};
}

function setupMocks() {
	const mockLoggerInstance = {
		write: vi.fn(),
		close: vi.fn(),
		getZippedBuffer: vi.fn().mockResolvedValue(Buffer.from('logs')),
		logPath: '/tmp/test.log',
		llmistLogPath: '/tmp/test-llmist.log',
		llmCallLogger: { logDir: '/tmp/llm-calls' },
	};
	mockCreateFileLogger.mockReturnValue(mockLoggerInstance as never);
	mockCreateAgentLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
	// Use actual cwd so process.chdir() doesn't fail on non-existent dir
	mockSetupRepository.mockResolvedValue(process.cwd());
	mockLoadCascadeEnv.mockReturnValue({});
	mockResolveModelConfig.mockResolvedValue({
		systemPrompt: 'You are an agent',
		model: 'test-model',
		maxIterations: 50,
	} as never);
	mockReadCard.mockResolvedValue('Card data');
	mockCreateProgressMonitor.mockReturnValue(null);
	return mockLoggerInstance;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.CASCADE_LOCAL_MODE = '';
});

describe('executeWithBackend', () => {
	it('executes backend and returns successful result', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(true);
		expect(result.output).toBe('Done');
		expect(result.prUrl).toBe('https://github.com/o/r/pull/1');
		expect(backend.execute).toHaveBeenCalled();
	});

	it('loads and unloads CASCADE env', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockLoadCascadeEnv).toHaveBeenCalled();
		expect(mockUnloadCascadeEnv).toHaveBeenCalled();
	});

	it('returns error result when backend throws', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockRejectedValue(new Error('Backend crashed'));
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Backend crashed');
	});

	it('includes log buffer in result', async () => {
		const loggerInstance = setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.logBuffer).toEqual(Buffer.from('logs'));
	});

	it('calls resolveRepoDir → setupRepository when no logDir', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockSetupRepository).toHaveBeenCalled();
	});

	it('uses logDir when provided instead of setupRepository', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ logDir: '/existing/dir' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockSetupRepository).not.toHaveBeenCalled();
	});

	it('cleans up resources in finally block', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockClearWatchdogCleanup).toHaveBeenCalled();
		expect(mockCleanupTempDir).toHaveBeenCalled();
		expect(mockCleanupLogFile).toHaveBeenCalled();
		expect(mockCleanupLogDirectory).toHaveBeenCalled();
	});

	it('skips all cleanup in CASCADE_LOCAL_MODE', async () => {
		process.env.CASCADE_LOCAL_MODE = 'true';
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput();

		await executeWithBackend(backend, 'implementation', input);

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockCleanupLogFile).not.toHaveBeenCalled();
		expect(mockCleanupLogDirectory).not.toHaveBeenCalled();
	});

	it('skips temp dir cleanup when logDir was provided', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ logDir: '/existing/dir' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		// But log files should still be cleaned up
		expect(mockCleanupLogFile).toHaveBeenCalled();
	});

	it('fetches card data for context injection when cardId present and no logDir', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ cardId: 'card123' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockReadCard).toHaveBeenCalledWith('card123', true);
	});

	it('skips context injection when logDir present', async () => {
		setupMocks();
		const backend = makeMockBackend();
		const input = makeInput({ cardId: 'card123', logDir: '/some/dir' });

		await executeWithBackend(backend, 'implementation', input);

		expect(mockReadCard).not.toHaveBeenCalled();
	});

	it('marks implementation agent as failed when no PR was created', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			// No prUrl
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Implementation completed but no PR was created');
		expect(logger.warn).toHaveBeenCalledWith(
			'Implementation agent completed without creating a PR',
			expect.objectContaining({ backend: 'test-backend' }),
		);
	});

	it('does not validate PR creation for non-implementation agents', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			// No prUrl
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'briefing', input);

		expect(result.success).toBe(true);
	});

	it('passes through when implementation agent creates a PR', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			prUrl: 'https://github.com/o/r/pull/5',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/o/r/pull/5');
	});

	it('does not validate PR creation when implementation agent already failed', async () => {
		setupMocks();
		const backend = makeMockBackend();
		vi.mocked(backend.execute).mockResolvedValue({
			success: false,
			output: '',
			error: 'Budget exceeded',
		});
		const input = makeInput();

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Budget exceeded');
	});

	it('zeroes cost when subscriptionCostZero is true and backend is claude-code', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 1.5,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'claude-code',
			overrides: {},
			subscriptionCostZero: true,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(0);
		expect(logger.info).toHaveBeenCalledWith(
			'Zeroing Claude Code cost (subscription mode)',
			expect.objectContaining({ originalCost: 1.5 }),
		);
	});

	it('preserves cost when subscriptionCostZero is false', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 2.0,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'claude-code',
			overrides: {},
			subscriptionCostZero: false,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(2.0);
	});

	it('preserves cost for non-claude-code backends even with subscriptionCostZero', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'llmist';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 3.0,
		});
		const input = makeInput();
		input.project.agentBackend = {
			default: 'llmist',
			overrides: {},
			subscriptionCostZero: true,
		};

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(3.0);
	});

	it('preserves cost when agentBackend config is undefined', async () => {
		setupMocks();
		const backend = makeMockBackend();
		backend.name = 'claude-code';
		vi.mocked(backend.execute).mockResolvedValue({
			success: true,
			output: 'Done',
			cost: 1.0,
		});
		const input = makeInput();
		// agentBackend is not set (default from makeProject)

		const result = await executeWithBackend(backend, 'implementation', input);

		expect(result.cost).toBe(1.0);
	});
});
