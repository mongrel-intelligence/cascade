import { describe, expect, it, vi } from 'vitest';

// Must mock engine modules before importing the registry
vi.mock('../../../src/backends/adapter.js', () => ({
	executeWithEngine: vi.fn(),
}));

vi.mock('../../../src/backends/bootstrap.js', () => ({
	registerBuiltInEngines: vi.fn(),
}));

vi.mock('../../../src/backends/registry.js', () => ({
	getEngine: vi.fn(),
	getRegisteredEngines: vi.fn(),
	registerEngine: vi.fn(),
}));

vi.mock('../../../src/backends/resolution.js', () => ({
	resolveEngineName: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { runAgent } from '../../../src/agents/registry.js';
import { executeWithEngine } from '../../../src/backends/adapter.js';
import { getEngine, getRegisteredEngines } from '../../../src/backends/registry.js';
import { resolveEngineName } from '../../../src/backends/resolution.js';
import type { AgentEngine } from '../../../src/backends/types.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

const mockResolveEngineName = vi.mocked(resolveEngineName);
const mockGetEngine = vi.mocked(getEngine);
const mockGetRegisteredEngines = vi.mocked(getRegisteredEngines);
const mockExecuteWithEngine = vi.mocked(executeWithEngine);

function makeInput(): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		cardId: 'card1',
		project: {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		},
		config: {
			projects: [],
		},
	} as AgentInput & { project: ProjectConfig; config: CascadeConfig };
}

function makeMockEngine(id: string, supportsAll = true): AgentEngine {
	return {
		definition: {
			id,
			label: id,
			description: `${id} description`,
			archetype: 'sdk',
			capabilities: [],
			modelSelection: { type: 'free-text' },
			logLabel: 'Engine Log',
		},
		execute: vi.fn().mockResolvedValue({ success: true, output: 'Done' }),
		supportsAgentType: vi.fn().mockReturnValue(supportsAll),
	};
}

describe('runAgent', () => {
	it('resolves engine name from config', async () => {
		const engine = makeMockEngine('llmist');
		mockResolveEngineName.mockReturnValue('llmist');
		mockGetEngine.mockReturnValue(engine);
		mockExecuteWithEngine.mockResolvedValue({ success: true, output: 'Done' });

		await runAgent('implementation', makeInput());

		expect(mockResolveEngineName).toHaveBeenCalledWith('implementation', expect.any(Object));
	});

	it('returns error when engine not found (lists registered engines)', async () => {
		mockResolveEngineName.mockReturnValue('unknown-engine');
		mockGetEngine.mockReturnValue(undefined);
		mockGetRegisteredEngines.mockReturnValue(['llmist']);

		const result = await runAgent('implementation', makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('Unknown agent engine: "unknown-engine"');
		expect(result.error).toContain('llmist');
	});

	it('returns error when engine does not support agent type', async () => {
		const engine = makeMockEngine('custom', false);
		mockResolveEngineName.mockReturnValue('custom');
		mockGetEngine.mockReturnValue(engine);

		const result = await runAgent('implementation', makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('does not support agent type "implementation"');
	});

	it('for llmist: calls executeWithEngine (unified adapter path)', async () => {
		const engine = makeMockEngine('llmist');
		mockResolveEngineName.mockReturnValue('llmist');
		mockGetEngine.mockReturnValue(engine);
		mockExecuteWithEngine.mockResolvedValue({
			success: true,
			output: 'Done via adapter',
		});

		const input = makeInput();
		const result = await runAgent('implementation', input);

		expect(mockExecuteWithEngine).toHaveBeenCalledWith(engine, 'implementation', input);
		expect(engine.execute).not.toHaveBeenCalled();
		expect(result.output).toBe('Done via adapter');
	});

	it('for claude-code: calls executeWithEngine with full lifecycle', async () => {
		const engine = makeMockEngine('claude-code');
		mockResolveEngineName.mockReturnValue('claude-code');
		mockGetEngine.mockReturnValue(engine);
		mockExecuteWithEngine.mockResolvedValue({
			success: true,
			output: 'Done via adapter',
		});

		const input = makeInput();
		const result = await runAgent('implementation', input);

		expect(mockExecuteWithEngine).toHaveBeenCalledWith(engine, 'implementation', input);
		expect(engine.execute).not.toHaveBeenCalled();
		expect(result.output).toBe('Done via adapter');
	});
});
