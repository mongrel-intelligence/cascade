import { describe, expect, it } from 'vitest';
import {
	createPRDef,
	createPRReviewDef,
	getCIRunLogsDef,
	getPRChecksDef,
	getPRCommentsDef,
	getPRDetailsDef,
	getPRDiffDef,
	postPRCommentDef,
	replyToReviewCommentDef,
	updatePRCommentDef,
} from '../../../../src/gadgets/github/definitions.js';
import type { ToolDefinition } from '../../../../src/gadgets/shared/toolDefinition.js';

const ALL_SCM_DEFINITIONS: ToolDefinition[] = [
	createPRDef,
	createPRReviewDef,
	getCIRunLogsDef,
	getPRChecksDef,
	getPRCommentsDef,
	getPRDetailsDef,
	getPRDiffDef,
	postPRCommentDef,
	replyToReviewCommentDef,
	updatePRCommentDef,
];

describe('GitHub SCM gadget definitions', () => {
	describe('all definitions integrity', () => {
		it('exports exactly 10 definitions', () => {
			expect(ALL_SCM_DEFINITIONS).toHaveLength(10);
		});

		it('all definitions have unique names', () => {
			const names = ALL_SCM_DEFINITIONS.map((d) => d.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it('every definition has a non-empty name', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				expect(typeof def.name).toBe('string');
				expect(def.name.length).toBeGreaterThan(0);
			}
		});

		it('every definition has a non-empty description', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				expect(typeof def.description).toBe('string');
				expect(def.description.length).toBeGreaterThan(0);
			}
		});

		it('every definition has a non-negative timeoutMs (0 is the "disabled" sentinel)', () => {
			// `timeoutMs: 0` is a deliberate opt-out for long-running tools whose
			// runtime is already managed externally (e.g. CreatePR — pre-commit /
			// pre-push hooks can take minutes, and the agent harness surrounds the
			// call with its own budget).  Anything negative is definitively a bug.
			for (const def of ALL_SCM_DEFINITIONS) {
				if (def.timeoutMs !== undefined) {
					expect(def.timeoutMs).toBeGreaterThanOrEqual(0);
				}
			}
		});

		it('every definition has a parameters object', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				expect(typeof def.parameters).toBe('object');
				expect(def.parameters).not.toBeNull();
			}
		});

		it('every definition has at least one example', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				expect(Array.isArray(def.examples)).toBe(true);
				expect((def.examples ?? []).length).toBeGreaterThan(0);
			}
		});

		it('all definition names are PascalCase', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				expect(def.name).toMatch(/^[A-Z][a-zA-Z0-9]+$/);
			}
		});

		it('all parameter descriptions are non-empty', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				for (const [paramName, paramDef] of Object.entries(def.parameters)) {
					expect(
						typeof paramDef.describe === 'string' && paramDef.describe.length > 0,
						`Parameter '${paramName}' in '${def.name}' must have a non-empty describe`,
					).toBe(true);
				}
			}
		});

		it('every param with gadgetOnly=true is the comment field', () => {
			for (const def of ALL_SCM_DEFINITIONS) {
				for (const [paramName, paramDef] of Object.entries(def.parameters)) {
					if (paramDef.gadgetOnly) {
						expect(paramName).toBe('comment');
					}
				}
			}
		});
	});

	describe('expected tool names are present', () => {
		it('includes CreatePR', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('CreatePR');
		});

		it('includes CreatePRReview', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('CreatePRReview');
		});

		it('includes GetPRDetails', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('GetPRDetails');
		});

		it('includes GetPRDiff', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('GetPRDiff');
		});

		it('includes GetPRChecks', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('GetPRChecks');
		});

		it('includes GetPRComments', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('GetPRComments');
		});

		it('includes PostPRComment', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('PostPRComment');
		});

		it('includes UpdatePRComment', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('UpdatePRComment');
		});

		it('includes ReplyToReviewComment', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('ReplyToReviewComment');
		});

		it('includes GetCIRunLogs', () => {
			expect(ALL_SCM_DEFINITIONS.map((d) => d.name)).toContain('GetCIRunLogs');
		});
	});

	// ─── CreatePR specific ────────────────────────────────────────────────────
	describe('createPRDef', () => {
		it('has required title, body, and head parameters', () => {
			expect(createPRDef.parameters.title?.required).toBe(true);
			expect(createPRDef.parameters.body?.required).toBe(true);
			expect(createPRDef.parameters.head?.required).toBe(true);
		});

		it('has optional base parameter', () => {
			expect(createPRDef.parameters.base?.optional).toBe(true);
		});

		it('has optional draft boolean parameter', () => {
			expect(createPRDef.parameters.draft?.type).toBe('boolean');
			expect(createPRDef.parameters.draft?.optional).toBe(true);
		});

		it('has commit and push boolean parameters with default=true', () => {
			expect(createPRDef.parameters.commit?.type).toBe('boolean');
			expect((createPRDef.parameters.commit as { default?: boolean })?.default).toBe(true);
			expect(createPRDef.parameters.push?.type).toBe('boolean');
			expect((createPRDef.parameters.push as { default?: boolean })?.default).toBe(true);
		});

		it('has timeoutMs disabled (0) — pre-commit/pre-push hooks may run for minutes and the harness handles long calls', () => {
			// Regression guard: do not reintroduce an outer time cap here without
			// first considering that legitimate pre-push hooks (full test suites)
			// can run five-plus minutes.  A shorter cap here turned into a
			// production incident once (see chore: remove-createpr-timeouts).
			expect(createPRDef.timeoutMs).toBe(0);
		});

		it('has body file input alternative in CLI', () => {
			const bodyAlt = createPRDef.cli?.fileInputAlternatives?.find((a) => a.paramName === 'body');
			expect(bodyAlt).toBeDefined();
			expect(bodyAlt?.fileFlag).toBe('body-file');
		});
	});

	// ─── CreatePRReview specific ──────────────────────────────────────────────
	describe('createPRReviewDef', () => {
		it('has required prNumber, event, and body parameters', () => {
			expect(createPRReviewDef.parameters.prNumber?.required).toBe(true);
			expect(createPRReviewDef.parameters.event?.required).toBe(true);
			expect(createPRReviewDef.parameters.body?.required).toBe(true);
		});

		it('event parameter is an enum with APPROVE, REQUEST_CHANGES, COMMENT', () => {
			const eventParam = createPRReviewDef.parameters.event;
			expect(eventParam?.type).toBe('enum');
			const options = (eventParam as { options?: string[] })?.options ?? [];
			expect(options).toContain('APPROVE');
			expect(options).toContain('REQUEST_CHANGES');
			expect(options).toContain('COMMENT');
		});

		it('has optional comments array parameter', () => {
			expect(createPRReviewDef.parameters.comments?.type).toBe('array');
			expect(createPRReviewDef.parameters.comments?.optional).toBe(true);
		});

		it('has auto-resolved owner and repo parameters', () => {
			const autoResolved = createPRReviewDef.cli?.autoResolved ?? [];
			const params = autoResolved.map((a) => a.paramName);
			expect(params).toContain('owner');
			expect(params).toContain('repo');
		});
	});

	// ─── GetCIRunLogs specific ────────────────────────────────────────────────
	describe('getCIRunLogsDef', () => {
		it('has required ref parameter', () => {
			expect(getCIRunLogsDef.parameters.ref?.required).toBe(true);
			expect(getCIRunLogsDef.parameters.ref?.type).toBe('string');
		});

		it('has auto-resolved owner and repo', () => {
			const autoResolved = getCIRunLogsDef.cli?.autoResolved ?? [];
			const params = autoResolved.map((a) => a.paramName);
			expect(params).toContain('owner');
			expect(params).toContain('repo');
		});
	});

	// ─── PostPRComment specific ───────────────────────────────────────────────
	describe('postPRCommentDef', () => {
		it('has required prNumber and body parameters', () => {
			expect(postPRCommentDef.parameters.prNumber?.required).toBe(true);
			expect(postPRCommentDef.parameters.body?.required).toBe(true);
		});

		it('has body file input alternative', () => {
			const bodyAlt = postPRCommentDef.cli?.fileInputAlternatives?.find(
				(a) => a.paramName === 'body',
			);
			expect(bodyAlt).toBeDefined();
		});
	});

	// ─── ReplyToReviewComment specific ───────────────────────────────────────
	describe('replyToReviewCommentDef', () => {
		it('has required prNumber, commentId, and body parameters', () => {
			expect(replyToReviewCommentDef.parameters.prNumber?.required).toBe(true);
			expect(replyToReviewCommentDef.parameters.commentId?.required).toBe(true);
			expect(replyToReviewCommentDef.parameters.body?.required).toBe(true);
		});
	});

	// ─── UpdatePRComment specific ─────────────────────────────────────────────
	describe('updatePRCommentDef', () => {
		it('has required commentId and body parameters', () => {
			expect(updatePRCommentDef.parameters.commentId?.required).toBe(true);
			expect(updatePRCommentDef.parameters.body?.required).toBe(true);
		});

		it('does not have prNumber (comment ID is enough)', () => {
			expect(updatePRCommentDef.parameters.prNumber).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// Spec 014 plan 2: createPRReviewDef declarative opt-in
// ---------------------------------------------------------------------------

describe('createPRReviewDef — spec 014 opt-in', () => {
	it('comments parameter declares cliAliases: ["comment"]', () => {
		const comments = createPRReviewDef.parameters.comments as {
			cliAliases?: readonly string[];
		};
		expect(comments.cliAliases).toEqual(['comment']);
	});

	it('cli.fileInputAlternatives includes body-file and comments-file entries', () => {
		const alts = createPRReviewDef.cli?.fileInputAlternatives ?? [];
		const bodyFile = alts.find((a) => a.paramName === 'body');
		const commentsFile = alts.find((a) => a.paramName === 'comments');

		expect(bodyFile).toBeDefined();
		expect(bodyFile?.fileFlag).toBe('body-file');
		expect(bodyFile?.parseAs).toBeUndefined();
		expect(bodyFile?.description).toBeTruthy();

		expect(commentsFile).toBeDefined();
		expect(commentsFile?.fileFlag).toBe('comments-file');
		expect(commentsFile?.parseAs).toBe('json');
		expect(commentsFile?.description).toBeTruthy();
	});
});
