import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextInjection, ToolManifest } from '../../../src/agents/contracts/index.js';

// Mock contextFiles module to avoid filesystem I/O
vi.mock('../../../src/backends/shared/contextFiles.js', () => ({
	buildInlineContextSection: vi.fn((injections: ContextInjection[]) => {
		if (injections.length === 0) return '';
		let section = '\n\n## Pre-loaded Context\n';
		for (const inj of injections) {
			section += `\n### ${inj.description} (${inj.toolName})\n`;
			section += `Parameters: ${JSON.stringify(inj.params)}\n`;
			section += `\`\`\`\n${inj.result}\n\`\`\`\n`;
		}
		return section;
	}),
	offloadLargeContext: vi.fn(),
}));

import {
	buildInlineContextSection,
	offloadLargeContext,
} from '../../../src/backends/shared/contextFiles.js';
import {
	buildSystemPrompt,
	buildTaskPrompt,
	buildToolGuidance,
} from '../../../src/backends/shared/nativeToolPrompts.js';

// ───────── helper ─────────
function makeManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
	return {
		name: 'ReadWorkItem',
		description: 'Read a work item.',
		cliCommand: 'cascade-tools pm read-work-item',
		parameters: {
			workItemId: { type: 'string', required: true, description: 'The work item ID' },
		},
		...overrides,
	};
}

// ───────── formatParam (tested indirectly through buildToolGuidance) ─────────
describe('buildToolGuidance', () => {
	it('returns empty string for empty tools array', () => {
		expect(buildToolGuidance([])).toBe('');
	});

	it('includes the CASCADE Tools heading', () => {
		const result = buildToolGuidance([makeManifest()]);
		expect(result).toContain('## CASCADE Tools');
	});

	it('includes cascade-tools critical note', () => {
		const result = buildToolGuidance([makeManifest()]);
		expect(result).toContain('CRITICAL');
		expect(result).toContain('cascade-tools');
	});

	it('includes tool name as a section heading', () => {
		const result = buildToolGuidance([makeManifest({ name: 'PostComment' })]);
		expect(result).toContain('### PostComment');
	});

	it('includes tool description', () => {
		const result = buildToolGuidance([makeManifest({ description: 'Post a comment.' })]);
		expect(result).toContain('Post a comment.');
	});

	it('includes cliCommand', () => {
		const result = buildToolGuidance([
			makeManifest({ cliCommand: 'cascade-tools pm post-comment' }),
		]);
		expect(result).toContain('cascade-tools pm post-comment');
	});

	it('wraps output in markdown code block', () => {
		const result = buildToolGuidance([makeManifest()]);
		expect(result).toContain('```bash');
		expect(result).toContain('```');
	});

	it('includes multiple tools', () => {
		const tools = [
			makeManifest({ name: 'ToolA', cliCommand: 'cascade-tools pm tool-a' }),
			makeManifest({ name: 'ToolB', cliCommand: 'cascade-tools pm tool-b' }),
		];
		const result = buildToolGuidance(tools);
		expect(result).toContain('### ToolA');
		expect(result).toContain('### ToolB');
	});

	describe('formatParam — required string param', () => {
		it('formats required string param without brackets', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						workItemId: { type: 'string', required: true, description: 'The work item ID' },
					},
				}),
			]);
			expect(result).toContain(' --workItemId <string>');
			expect(result).not.toContain('[--workItemId');
		});

		it('includes description as a comment', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						workItemId: { type: 'string', required: true, description: 'The work item ID' },
					},
				}),
			]);
			expect(result).toContain('# The work item ID');
		});
	});

	describe('formatParam — optional string param', () => {
		it('formats optional string param with brackets', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						base: { type: 'string', required: false },
					},
				}),
			]);
			expect(result).toContain('[--base <string>]');
		});
	});

	describe('formatParam — array param (repeatable)', () => {
		it('formats required array param as repeatable', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						items: { type: 'array', required: true },
					},
				}),
			]);
			// Singular of 'items' is 'item'
			expect(result).toContain('--item <string> (repeatable)');
			expect(result).not.toContain('[--item');
		});

		it('formats optional array param as repeatable with brackets', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						labels: { type: 'array', required: false },
					},
				}),
			]);
			// Singular of 'labels' is 'label'
			expect(result).toContain('[--label <string> (repeatable)]');
		});
	});

	describe('formatParam — boolean param', () => {
		it('formats boolean param with default=true as --no-param', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						commit: { type: 'boolean', default: true },
					},
				}),
			]);
			expect(result).toContain('[--no-commit]');
		});

		it('formats boolean param with default=false as --param', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						draft: { type: 'boolean', default: false },
					},
				}),
			]);
			expect(result).toContain('[--draft]');
		});

		it('formats boolean param without default as --param', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						verbose: { type: 'boolean' },
					},
				}),
			]);
			expect(result).toContain('[--verbose]');
		});
	});

	describe('formatParam — no description', () => {
		it('does not include # comment when description is absent', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						workItemId: { type: 'string', required: true },
					},
				}),
			]);
			// The param line itself should not contain a # comment (only markdown headings use #)
			const paramLine = result.split('\n').find((line) => line.includes('--workItemId'));
			expect(paramLine).toBeDefined();
			expect(paramLine).not.toContain('#');
		});
	});
});

// ───────── buildSystemPrompt ─────────
describe('buildSystemPrompt', () => {
	it('prepends native tool execution rules', () => {
		const result = buildSystemPrompt('My agent prompt.', []);
		expect(result).toContain('## Native Tool Execution Rules');
	});

	it('includes the system prompt text', () => {
		const result = buildSystemPrompt('My agent prompt.', []);
		expect(result).toContain('My agent prompt.');
	});

	it('native tool rules appear before system prompt', () => {
		const result = buildSystemPrompt('AGENT_MARKER', []);
		const rulesPos = result.indexOf('## Native Tool Execution Rules');
		const agentPos = result.indexOf('AGENT_MARKER');
		expect(rulesPos).toBeLessThan(agentPos);
	});

	it('appends tool guidance when tools are provided', () => {
		const tools = [makeManifest({ name: 'ReadWorkItem' })];
		const result = buildSystemPrompt('Agent prompt.', tools);
		expect(result).toContain('## CASCADE Tools');
		expect(result).toContain('### ReadWorkItem');
	});

	it('does not append tool guidance when tools array is empty', () => {
		const result = buildSystemPrompt('Agent prompt.', []);
		expect(result).not.toContain('## CASCADE Tools');
	});

	it('tool guidance appears after system prompt', () => {
		const tools = [makeManifest()];
		const result = buildSystemPrompt('AGENT_MARKER', tools);
		const agentPos = result.indexOf('AGENT_MARKER');
		const toolsPos = result.indexOf('## CASCADE Tools');
		expect(agentPos).toBeLessThan(toolsPos);
	});

	it('blocks pseudo tool call instruction is included', () => {
		const result = buildSystemPrompt('Agent prompt.', []);
		expect(result).toContain('Never write pseudo tool calls');
	});
});

// ───────── buildTaskPrompt ─────────
describe('buildTaskPrompt', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns task prompt unchanged when no context injections', async () => {
		const result = await buildTaskPrompt('Do the task.', [], '/repo');
		expect(result.prompt).toBe('Do the task.');
		expect(result.hasOffloadedContext).toBe(false);
	});

	it('does not call offloadLargeContext when injections is empty', async () => {
		await buildTaskPrompt('Do the task.', [], '/repo');
		expect(offloadLargeContext).not.toHaveBeenCalled();
	});

	it('calls offloadLargeContext with repoDir and injections', async () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadWorkItem',
				params: { workItemId: 'abc' },
				result: 'data',
				description: 'Work item data',
			},
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: injections,
			offloadedFiles: [],
			offloadedImages: [],
			instructions: '',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('\n\ninline section');

		await buildTaskPrompt('Do the task.', injections, '/repo');
		expect(offloadLargeContext).toHaveBeenCalledWith('/repo', injections);
	});

	it('appends inline context section to prompt', async () => {
		const injections: ContextInjection[] = [
			{ toolName: 'ReadWorkItem', params: {}, result: 'card content', description: 'Card data' },
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: injections,
			offloadedFiles: [],
			offloadedImages: [],
			instructions: '',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('\n\n## Inline Context');

		const result = await buildTaskPrompt('Base prompt.', injections, '/repo');
		expect(result.prompt).toContain('Base prompt.');
		expect(result.prompt).toContain('## Inline Context');
	});

	it('appends offload instructions when instructions are present', async () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadWorkItem',
				params: {},
				result: 'x'.repeat(5000),
				description: 'Big context',
			},
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: [],
			offloadedFiles: [
				{
					relativePath: '.cascade/context/big-context-0.txt',
					description: 'Big context',
					tokens: 1250,
				},
			],
			offloadedImages: [],
			instructions: '## Context Files\n\nRead these files.',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('');

		const result = await buildTaskPrompt('Base prompt.', injections, '/repo');
		expect(result.prompt).toContain('## Context Files');
		expect(result.prompt).toContain('Read these files.');
	});

	it('sets hasOffloadedContext=true when offloaded files are present', async () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadWorkItem',
				params: {},
				result: 'x'.repeat(5000),
				description: 'Big context',
			},
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: [],
			offloadedFiles: [
				{
					relativePath: '.cascade/context/big-context-0.txt',
					description: 'Big context',
					tokens: 1250,
				},
			],
			offloadedImages: [],
			instructions: 'Read these files.',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('');

		const result = await buildTaskPrompt('Base prompt.', injections, '/repo');
		expect(result.hasOffloadedContext).toBe(true);
	});

	it('sets hasOffloadedContext=true when offloaded images are present', async () => {
		const injections: ContextInjection[] = [
			{
				toolName: 'ReadWorkItem',
				params: {},
				result: 'content',
				description: 'Context with image',
				images: [{ base64Data: 'abc', mimeType: 'image/png' }],
			},
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: injections,
			offloadedFiles: [],
			offloadedImages: [{ relativePath: '.cascade/context/images/ctx-0-img-0.png' }],
			instructions: 'Read these images.',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('\n\ninline section');

		const result = await buildTaskPrompt('Base prompt.', injections, '/repo');
		expect(result.hasOffloadedContext).toBe(true);
	});

	it('sets hasOffloadedContext=false when nothing is offloaded', async () => {
		const injections: ContextInjection[] = [
			{ toolName: 'ReadWorkItem', params: {}, result: 'small', description: 'Small context' },
		];
		vi.mocked(offloadLargeContext).mockResolvedValueOnce({
			inlineInjections: injections,
			offloadedFiles: [],
			offloadedImages: [],
			instructions: '',
		});
		vi.mocked(buildInlineContextSection).mockReturnValueOnce('\n\ninline section');

		const result = await buildTaskPrompt('Base prompt.', injections, '/repo');
		expect(result.hasOffloadedContext).toBe(false);
	});
});
