import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	applyCompletionEvidence,
	type CompletionEvidence,
	evaluatePushedChanges,
	readCompletionEvidence,
	readRepoState,
} from '../../../src/backends/completion.js';
import type { AgentEngineResult } from '../../../src/backends/types.js';

describe('applyCompletionEvidence', () => {
	it('returns result unchanged when no sidecar exists', () => {
		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
			prUrl: undefined,
			prEvidence: undefined,
		};
		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath: '/nonexistent/path.json',
		});
		expect(updated).toBe(result);
	});

	it('returns result unchanged when no completionRequirements', () => {
		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
		};
		const updated = applyCompletionEvidence(result, undefined);
		expect(updated).toBe(result);
	});

	it('upgrades text evidence to authoritative when sidecar exists', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(
			prSidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/owner/repo/pull/42',
				source: 'cascade-tools scm create-pr',
			}),
		);

		const result: AgentEngineResult = {
			success: true,
			output: 'PR created at https://github.com/owner/repo/pull/42',
			cost: 0.1,
			prUrl: 'https://github.com/owner/repo/pull/42',
			prEvidence: { source: 'text', authoritative: false },
		};

		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath,
		});

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');
		expect(updated.prEvidence).toEqual({
			source: 'native-tool-sidecar',
			authoritative: true,
			command: 'cascade-tools scm create-pr',
		});
		// Should preserve other fields
		expect(updated.success).toBe(true);
		expect(updated.output).toBe('PR created at https://github.com/owner/repo/pull/42');
		expect(updated.cost).toBe(0.1);
	});

	it('adds PR evidence when result had no prUrl', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(
			prSidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/owner/repo/pull/99',
				source: 'cascade-tools scm create-pr',
			}),
		);

		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
		};

		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath,
		});

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/99');
		expect(updated.prEvidence?.authoritative).toBe(true);
	});

	it('uses default command when source is missing from sidecar', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(prSidecarPath, JSON.stringify({ prUrl: 'https://github.com/o/r/pull/1' }));

		const result: AgentEngineResult = { success: true, output: '', cost: 0 };
		const updated = applyCompletionEvidence(result, { prSidecarPath });

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prEvidence?.command).toBe('cascade-tools scm create-pr');
	});
});

const RESPONSE_URL = 'https://github.com/o/r/pull/7#issuecomment-1';

function evidenceWith(overrides: Partial<CompletionEvidence>): CompletionEvidence {
	return {
		hasAuthoritativePR: false,
		hasAuthoritativeReview: false,
		hasAuthoritativePushedChanges: false,
		hasPMWrite: false,
		hasAuthoritativePRResponse: false,
		prResponseSidecarMalformed: false,
		...overrides,
	};
}

describe('readCompletionEvidence — pr-response', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-response-'));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function writeResponseSidecar(content: unknown): string {
		const path = join(tempDir, 'pr-response.json');
		writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
		return path;
	}

	it('reads a well-formed PR-response sidecar', () => {
		const prResponseSidecarPath = writeResponseSidecar({
			source: 'cascade-tools scm post-pr-comment',
			url: RESPONSE_URL,
			kind: 'top-level',
			id: 1,
			prNumber: 7,
		});

		const evidence = readCompletionEvidence({ prResponseSidecarPath });

		expect(evidence.hasAuthoritativePRResponse).toBe(true);
		expect(evidence.prResponse).toEqual({
			url: RESPONSE_URL,
			kind: 'top-level',
			command: 'cascade-tools scm post-pr-comment',
		});
		expect(evidence.prResponseSidecarMalformed).toBe(false);
	});

	it('accepts the inline-reply kind', () => {
		const prResponseSidecarPath = writeResponseSidecar({
			source: 'cascade-tools scm reply-to-review-comment',
			url: RESPONSE_URL,
			kind: 'inline-reply',
		});

		expect(readCompletionEvidence({ prResponseSidecarPath }).prResponse?.kind).toBe('inline-reply');
	});

	it('defaults the command when source is absent', () => {
		const prResponseSidecarPath = writeResponseSidecar({ url: RESPONSE_URL, kind: 'top-level' });

		expect(readCompletionEvidence({ prResponseSidecarPath }).prResponse?.command).toBe(
			'cascade-tools scm post-pr-comment',
		);
	});

	it('treats a sidecar without url as malformed, not as evidence', () => {
		const prResponseSidecarPath = writeResponseSidecar({ kind: 'top-level' });

		const evidence = readCompletionEvidence({ prResponseSidecarPath });

		expect(evidence.hasAuthoritativePRResponse).toBe(false);
		expect(evidence.prResponse).toBeUndefined();
		expect(evidence.prResponseSidecarMalformed).toBe(true);
	});

	it('treats an unknown kind as malformed', () => {
		const prResponseSidecarPath = writeResponseSidecar({ url: RESPONSE_URL, kind: 'edit' });

		const evidence = readCompletionEvidence({ prResponseSidecarPath });

		expect(evidence.hasAuthoritativePRResponse).toBe(false);
		expect(evidence.prResponseSidecarMalformed).toBe(true);
	});

	it('treats invalid JSON as malformed', () => {
		const prResponseSidecarPath = writeResponseSidecar('{not json');

		const evidence = readCompletionEvidence({ prResponseSidecarPath });

		expect(evidence.hasAuthoritativePRResponse).toBe(false);
		expect(evidence.prResponseSidecarMalformed).toBe(true);
	});

	it('reports no PR response when the sidecar path is unset or the file is missing', () => {
		for (const prResponseSidecarPath of [undefined, join(tempDir, 'missing.json')]) {
			const evidence = readCompletionEvidence({ prResponseSidecarPath });
			expect(evidence.hasAuthoritativePRResponse).toBe(false);
			expect(evidence.prResponseSidecarMalformed).toBe(false);
		}
	});
});

describe('readRepoState', () => {
	let repoDir: string;

	function git(...args: string[]): string {
		return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
			cwd: repoDir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	}

	function commit(message: string): string {
		git('add', '-A');
		git(
			'-c',
			'user.name=t',
			'-c',
			'user.email=t@t',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			message,
		);
		return git('rev-parse', 'HEAD');
	}

	beforeEach(() => {
		repoDir = mkdtempSync(join(tmpdir(), 'cascade-repo-state-'));
		git('init', '-q');
	});

	afterEach(() => {
		rmSync(repoDir, { recursive: true, force: true });
	});

	it('reports a clean tree at the initial commit', () => {
		const initial = commit('a');

		expect(readRepoState(repoDir, initial)).toEqual({
			clean: true,
			headSha: initial,
			headUnchanged: true,
		});
	});

	it('reports an uncommitted change as dirty', () => {
		const initial = commit('a');
		writeFileSync(join(repoDir, 'f.txt'), 'x');
		git('add', 'f.txt');

		expect(readRepoState(repoDir, initial)).toMatchObject({ clean: false, headUnchanged: true });
	});

	it('reports a new commit as HEAD moved', () => {
		const initial = commit('a');
		const next = commit('b');

		expect(readRepoState(repoDir, initial)).toEqual({
			clean: true,
			headSha: next,
			headUnchanged: false,
		});
	});

	it('counts an untracked file as dirty', () => {
		const initial = commit('a');
		writeFileSync(join(repoDir, 'untracked.txt'), 'x');

		expect(readRepoState(repoDir, initial)?.clean).toBe(false);
	});

	it('returns undefined outside a git repository', () => {
		const plainDir = mkdtempSync(join(tmpdir(), 'cascade-not-a-repo-'));
		try {
			expect(readRepoState(plainDir, 'abc')).toBeUndefined();
		} finally {
			rmSync(plainDir, { recursive: true, force: true });
		}
	});

	it('attaches repoState to evidence only when repoDir and initialHeadSha are both given', () => {
		const initial = commit('a');

		expect(readCompletionEvidence({ repoDir }).repoState).toBeUndefined();
		expect(readCompletionEvidence({ initialHeadSha: initial }).repoState).toBeUndefined();
		expect(readCompletionEvidence({ repoDir, initialHeadSha: initial }).repoState).toEqual({
			clean: true,
			headSha: initial,
			headUnchanged: true,
		});
	});
});

describe('evaluatePushedChanges', () => {
	const RESPONSE = {
		url: RESPONSE_URL,
		kind: 'top-level' as const,
		command: 'cascade-tools scm post-pr-comment',
	};
	const CLEAN_REPO = { clean: true, headSha: 'aaa', headUnchanged: true };
	const WITH_ALTERNATIVE = {
		requiresPushedChanges: true,
		pushedChangesAlternatives: ['pr-response'] as const,
	};
	const NO_PUSH_REJECTION = {
		outcome: 'pushed-changes',
		reason: expect.stringMatching(/no pushed-changes sidecar/),
	};

	it('returns undefined when pushed changes are not required', () => {
		expect(evaluatePushedChanges(undefined, evidenceWith({}))).toBeUndefined();
		expect(evaluatePushedChanges({ requiresPR: true }, evidenceWith({}))).toBeUndefined();
	});

	it('pushed-changes evidence satisfies the requirement', () => {
		expect(
			evaluatePushedChanges(
				{ requiresPushedChanges: true },
				evidenceWith({ hasAuthoritativePushedChanges: true }),
			),
		).toEqual({ satisfiedBy: 'pushed-changes' });
	});

	it('without alternatives, a PR response alone is rejected', () => {
		expect(
			evaluatePushedChanges(
				{ requiresPushedChanges: true },
				evidenceWith({
					hasAuthoritativePRResponse: true,
					prResponse: RESPONSE,
					repoState: CLEAN_REPO,
				}),
			),
		).toEqual({ satisfiedBy: null, rejections: [NO_PUSH_REJECTION] });
	});

	it('pr-response with a clean, unchanged repository satisfies the requirement', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({
					hasAuthoritativePRResponse: true,
					prResponse: RESPONSE,
					repoState: CLEAN_REPO,
				}),
			),
		).toEqual({ satisfiedBy: 'pr-response' });
	});

	it('pushed-changes wins when both branches are satisfied', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({
					hasAuthoritativePushedChanges: true,
					hasAuthoritativePRResponse: true,
					prResponse: RESPONSE,
					repoState: CLEAN_REPO,
				}),
			),
		).toEqual({ satisfiedBy: 'pushed-changes' });
	});

	it('pr-response is rejected when the tree is dirty', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({
					hasAuthoritativePRResponse: true,
					prResponse: RESPONSE,
					repoState: { ...CLEAN_REPO, clean: false },
				}),
			),
		).toEqual({
			satisfiedBy: null,
			rejections: [
				NO_PUSH_REJECTION,
				{ outcome: 'pr-response', reason: expect.stringMatching(/uncommitted changes/) },
			],
		});
	});

	it('pr-response is rejected when HEAD moved', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({
					hasAuthoritativePRResponse: true,
					prResponse: RESPONSE,
					repoState: { clean: true, headSha: 'bbb', headUnchanged: false },
				}),
			),
		).toEqual({
			satisfiedBy: null,
			rejections: [
				NO_PUSH_REJECTION,
				{ outcome: 'pr-response', reason: expect.stringMatching(/HEAD moved.*bbb/) },
			],
		});
	});

	it('pr-response is rejected when repository state is unavailable', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({ hasAuthoritativePRResponse: true, prResponse: RESPONSE }),
			),
		).toEqual({
			satisfiedBy: null,
			rejections: [
				NO_PUSH_REJECTION,
				{ outcome: 'pr-response', reason: expect.stringMatching(/repository state unavailable/) },
			],
		});
	});

	it('pr-response is rejected when the sidecar is malformed, naming the malformation', () => {
		expect(
			evaluatePushedChanges(
				WITH_ALTERNATIVE,
				evidenceWith({ prResponseSidecarMalformed: true, repoState: CLEAN_REPO }),
			),
		).toEqual({
			satisfiedBy: null,
			rejections: [
				NO_PUSH_REJECTION,
				{ outcome: 'pr-response', reason: expect.stringMatching(/malformed/) },
			],
		});
	});

	it('pr-response is rejected when nothing was recorded', () => {
		expect(
			evaluatePushedChanges(WITH_ALTERNATIVE, evidenceWith({ repoState: CLEAN_REPO })),
		).toEqual({
			satisfiedBy: null,
			rejections: [
				NO_PUSH_REJECTION,
				{ outcome: 'pr-response', reason: expect.stringMatching(/no PR response recorded/) },
			],
		});
	});
});
