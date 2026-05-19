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
import {
	createPRReviewDef,
	replyToReviewCommentDef,
	updatePRCommentDef,
} from '../../../src/gadgets/github/definitions.js';
import { readWorkItemDef } from '../../../src/gadgets/pm/definitions.js';
import { generateToolManifest } from '../../../src/gadgets/shared/manifestGenerator.js';

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

	describe('formatParam — enum/scalar examples', () => {
		it('renders enum examples as raw CLI values instead of JSON string literals', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						event: {
							type: 'string',
							options: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
							required: true,
							example: 'APPROVE',
						},
					},
				}),
			]);

			expect(result).toContain('# example: --event APPROVE');
			expect(result).not.toContain(`--event '"APPROVE"'`);
			expect(result).not.toContain(`--event '"REQUEST_CHANGES"'`);
		});

		it('renders number examples as raw CLI values', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						prNumber: { type: 'number', required: true, example: 42 },
					},
				}),
			]);

			expect(result).toContain('# example: --prNumber 42');
			expect(result).not.toContain(`--prNumber '42'`);
		});

		it('shell-quotes scalar string examples only when needed', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						body: {
							type: 'string',
							required: true,
							example: 'LGTM after CI passes',
						},
					},
				}),
			]);

			expect(result).toContain("# example: --body 'LGTM after CI passes'");
		});

		it('renders CreatePRReview event guidance without JSON string quotes', () => {
			const result = buildToolGuidance([generateToolManifest(createPRReviewDef)]);

			expect(result).toContain('# example: --event APPROVE');
			expect(result).not.toContain(`--event '"APPROVE"'`);
		});

		it('renders ReadWorkItem work item IDs as bare shell-safe values', () => {
			const result = buildToolGuidance([generateToolManifest(readWorkItemDef)]);

			expect(result).toContain('# example: --workItemId abc123');
			expect(result).not.toContain(`--workItemId '"abc123"'`);
			expect(result).not.toContain(`--workItemId 'abc123'`);
			expect(result).not.toContain(`--workItemId "abc123"`);
		});

		it('renders CreatePRReview body-file guidance from definition metadata', () => {
			const result = buildToolGuidance([generateToolManifest(createPRReviewDef)]);

			expect(result).toContain('[--body-file <string>]');
			expect(result).toContain('Read review body from file (use - for stdin)');
		});

		it('renders UpdatePRComment body-file guidance from definition metadata', () => {
			const result = buildToolGuidance([generateToolManifest(updatePRCommentDef)]);

			expect(result).toContain('[--body-file <string>]');
			expect(result).toContain('Read comment body from file (use - for stdin)');
		});

		it('renders ReplyToReviewComment body-file guidance from definition metadata', () => {
			const result = buildToolGuidance([generateToolManifest(replyToReviewCommentDef)]);

			expect(result).toContain('[--body-file <string>]');
			expect(result).toContain('Read reply body from file (use - for stdin)');
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

	describe('formatParam — primitive array (items:"string") — repeatable', () => {
		// Spec 014: the renderer used to strip trailing 's' from every array name.
		// That was the root cause of prod run 5d993b04 — an agent sent `--comment`
		// because the prompt told it to. Arrays now always render with the actual
		// declared key. Repeatable semantics stay the same for items:"string".
		it('formats required primitive-array param with the actual plural name', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						items: { type: 'array', items: 'string', required: true },
					},
				}),
			]);
			expect(result).toContain('--items <string> (repeatable)');
			expect(result).not.toContain('--item <string>'); // old bug: s-stripped singular
			expect(result).not.toContain('[--items'); // required → no brackets
		});

		it('formats optional primitive-array param with the actual plural name and brackets', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						labels: { type: 'array', items: 'string', required: false },
					},
				}),
			]);
			expect(result).toContain('[--labels <string> (repeatable)]');
			expect(result).not.toContain('--label <string>'); // old bug
		});

		it('renders primitive-array examples as repeated flags instead of a JSON blob', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						labels: {
							type: 'array',
							items: 'string',
							required: false,
							example: ['bug', 'docs'],
						},
					},
				}),
			]);

			expect(result).toContain('# example: --labels bug --labels docs');
			expect(result).not.toContain(`--labels '["bug","docs"]'`);
		});
	});

	describe('formatParam — array of object (items:"object") — JSON blob (spec 014)', () => {
		it('renders required array-of-object as a single JSON flag, not repeatable', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						comments: {
							type: 'array',
							items: 'object',
							required: false,
							description: 'Inline review comments',
						},
					},
				}),
			]);
			expect(result).toContain("[--comments '<json>']");
			// The "repeatable string" lie from the old renderer is gone
			expect(result).not.toContain('repeatable');
			expect(result).not.toContain('--comment <string>');
		});

		it('renders aliases next to the canonical flag name', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						comments: {
							type: 'array',
							items: 'object',
							required: false,
							aliases: ['comment'],
						},
					},
				}),
			]);
			expect(result).toContain('--comments|--comment');
		});

		it('renders a one-line example line beneath the flag when the manifest provides one', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						comments: {
							type: 'array',
							items: 'object',
							required: false,
							example: [{ path: 'src/x.ts', line: 1, body: 'nit' }],
						},
					},
				}),
			]);
			// Example is surfaced on its own indented comment line
			expect(result).toContain('example:');
			expect(result).toContain(
				`--comments '${JSON.stringify([{ path: 'src/x.ts', line: 1, body: 'nit' }])}'`,
			);
		});
	});

	describe('formatParam — object param — JSON blob (spec 014)', () => {
		it('renders object param as a single JSON flag', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						config: { type: 'object', required: true, description: 'Config JSON' },
					},
				}),
			]);
			expect(result).toContain("--config '<json>'");
			expect(result).not.toContain('<object>'); // shouldn't leak the bare type
		});

		it('renders object examples as a single JSON payload', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						config: { type: 'object', required: true, example: { mode: 'strict' } },
					},
				}),
			]);

			expect(result).toContain(`# example: --config '${JSON.stringify({ mode: 'strict' })}'`);
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

		// Prod regression — 9/14 codex runs hit `--includeComments true` because
		// the example renderer emitted `# example: --includeComments 'true'` while
		// oclif's `Flags.boolean({ allowNo: true })` rejects that form. The
		// example must match the canonical CLI grammar — `--key` for true,
		// `--no-key` for false — never `--key 'true'`.
		it('renders example=true as the toggle form (--key) — never as a quoted value', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						includeComments: { type: 'boolean', default: true, example: true },
					},
				}),
			]);
			expect(result).not.toContain(`--includeComments 'true'`);
			expect(result).not.toContain('--includeComments "true"');
			expect(result).toContain('# example: --includeComments');
		});

		it('renders example=false as the negation form (--no-key)', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						includeComments: { type: 'boolean', default: true, example: false },
					},
				}),
			]);
			expect(result).not.toContain(`--includeComments 'false'`);
			expect(result).toContain('# example: --no-includeComments');
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

	// -------------------------------------------------------------------------
	// MNG-1059: shell-sensitive multiline example suppression
	// -------------------------------------------------------------------------
	describe('formatParam — shell-sensitive example suppression (MNG-1059)', () => {
		it('suppresses inline example for direct text param when example contains backticks AND a file-input companion is declared', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						body: {
							type: 'string',
							required: true,
							example: 'Use `npm test` to verify',
							fileInputAlternative: 'body-file',
						},
						'body-file': {
							type: 'string',
							fileInputFor: 'body',
							description: 'Read body from file (use - for stdin)',
						},
					},
				}),
			]);

			expect(result).not.toContain("--body 'Use `npm test` to verify'");
			expect(result).toContain('--body-file <path>');
			expect(result).toContain('shell-sensitive');
		});

		it('suppresses inline example for direct text param when example contains $(...) AND a file-input companion is declared', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						details: {
							type: 'string',
							required: true,
							example: 'Detected $(whoami) running unexpectedly',
							fileInputAlternative: 'details-file',
						},
						'details-file': {
							type: 'string',
							fileInputFor: 'details',
							description: 'Read details from file (use - for stdin)',
						},
					},
				}),
			]);

			expect(result).not.toContain("'Detected $(whoami)");
			expect(result).toContain('--details-file <path>');
		});

		it('suppresses inline example for direct text param when example contains a newline AND a file-input companion is declared', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						body: {
							type: 'string',
							required: true,
							example: '## Summary\n\nMultiline content',
							fileInputAlternative: 'body-file',
						},
						'body-file': {
							type: 'string',
							fileInputFor: 'body',
							description: 'Read body from file (use - for stdin)',
						},
					},
				}),
			]);

			expect(result).not.toContain("'## Summary");
			expect(result).toContain('--body-file <path>');
		});

		it('keeps inline example for shell-safe scalar values even when a file companion exists', () => {
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						body: {
							type: 'string',
							required: true,
							example: 'LGTM',
							fileInputAlternative: 'body-file',
						},
						'body-file': {
							type: 'string',
							fileInputFor: 'body',
							description: 'Read body from file (use - for stdin)',
						},
					},
				}),
			]);

			// LGTM is shell-safe — renderer keeps it inline (bare, no quotes).
			expect(result).toContain('# example: --body LGTM');
			expect(result).not.toContain('--body-file <path>  #');
		});

		it('keeps inline example for shell-sensitive content when NO file-input companion is declared', () => {
			// Without a fileInputAlternative the renderer has no safer flag to
			// redirect to — preserve the original behavior so existing gadgets
			// without a file companion still render their examples.
			const result = buildToolGuidance([
				makeManifest({
					parameters: {
						body: {
							type: 'string',
							required: true,
							example: 'Use `code` here',
						},
					},
				}),
			]);

			expect(result).toContain("--body 'Use `code` here'");
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

	// MNG-1055: the worker image guarantees a baseline of native-session
	// tools — Python shim, jq/rg/fd/git/tmux/cascade-tools, and a shared
	// Playwright Chromium cache at $PLAYWRIGHT_BROWSERS_PATH. The system
	// prompt must communicate that contract so agents reach for these
	// directly instead of trying to install or work around them. Pinned
	// here so future trim-the-prompt edits do not silently drop the
	// guarantees that the friction clusters (MNG-887…1044, MNG-998,
	// MNG-1048) were originally filed about.
	describe('runtime-tool guarantees (MNG-1055)', () => {
		it('lists Python shim guarantee with both python and python3 names', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('Guaranteed runtime tools');
			expect(result).toContain('`python`');
			expect(result).toContain('`python3`');
		});

		it('lists the other baseline shell tools agents should reach for', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('`jq`');
			expect(result).toContain('`rg`');
			expect(result).toContain('`fd`');
			expect(result).toContain('`git`');
			expect(result).toContain('`tmux`');
			expect(result).toContain('`cascade-tools`');
		});

		it('points at the shared Playwright Chromium cache via PLAYWRIGHT_BROWSERS_PATH', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('Playwright');
			expect(result).toContain('$PLAYWRIGHT_BROWSERS_PATH');
		});

		it('runtime guarantees render even when no cascade-tools are wired', () => {
			// The guarantees are part of the static execution rules, not the
			// CASCADE Tools section — so they render whether or not the
			// caller passes a tool manifest. This keeps the contract visible
			// for engines that mount zero cascade-tools (early debug runs).
			const noTools = buildSystemPrompt('Agent prompt.', []);
			const withTools = buildSystemPrompt('Agent prompt.', [makeManifest()]);
			expect(noTools).toContain('Guaranteed runtime tools');
			expect(withTools).toContain('Guaranteed runtime tools');
		});

		it('does not alter the rendered cascade-tools CLI documentation', () => {
			// Pins that the prompt addition is purely additive — the
			// CreatePRReview / ReadWorkItem command bodies the generator
			// emits are unchanged. Catches accidental reorderings that
			// would push agents back to the pre-014 pseudo-tool surface.
			const result = buildSystemPrompt('Agent prompt.', [makeManifest({ name: 'ReadWorkItem' })]);
			expect(result).toContain('### ReadWorkItem');
			expect(result).toContain('cascade-tools pm read-work-item');
			expect(result).toContain('--workItemId <string>');
		});
	});

	// MNG-1059: the cascade-tools shell-safety rules must be visible in the
	// rendered system prompt so agents know to prefer --*-file paths and to
	// avoid passing two stdin consumers in a single command.
	describe('cascade-tools shell-safety rules (MNG-1059)', () => {
		it('renders the shell-safety section header', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('### cascade-tools shell-safety rules');
		});

		it('tells agents to prefer --*-file <path> for markdown / multiline / backticks', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('--body-file');
			expect(result).toContain('markdown');
			expect(result).toContain('multiline');
		});

		it('warns about the one-stdin-consumer invariant', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('Only **one**');
			expect(result).toContain('stdin (fd 0)');
			expect(result).toContain('drained once');
		});

		it('shows the heredoc pattern for one payload', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('post-pr-comment');
			expect(result).toContain('--body-file -');
		});

		it('shows the two-payload pattern (one temp file + one heredoc)', () => {
			const result = buildSystemPrompt('Agent prompt.', []);
			expect(result).toContain('create-pr-review');
			expect(result).toContain('--comments-file -');
		});
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
