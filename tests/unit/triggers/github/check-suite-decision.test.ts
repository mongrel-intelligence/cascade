import { describe, expect, it, vi } from 'vitest';
import type { CheckSuiteStatus } from '../../../../src/github/client.js';
import {
	decideCheckSuiteGates,
	decideCheckSuiteOutcome,
} from '../../../../src/triggers/github/check-suite-decision.js';
import { resolveCheckSuitePRNumber } from '../../../../src/triggers/github/pr-resolution.js';
import { createMockProject } from '../../../helpers/factories.js';
import { mockPersonaIdentities } from '../../../helpers/mockPersonas.js';

const project = createMockProject();

function status(checkRuns: CheckSuiteStatus['checkRuns']): CheckSuiteStatus {
	return {
		totalCount: checkRuns.length,
		checkRuns,
		allPassing: checkRuns.every(
			(checkRun) => checkRun.status === 'completed' && checkRun.conclusion === 'success',
		),
	};
}

describe('decideCheckSuiteOutcome', () => {
	const baseOptions = {
		prNumber: 42,
		prAuthorLogin: 'cascade-impl',
		prBaseRef: 'main',
		project,
		personaIdentities: mockPersonaIdentities,
		handlerName: 'check-suite-success',
	} as const;

	it('returns respond-to-ci for mixed success/failure aggregate state', () => {
		const decision = decideCheckSuiteOutcome({
			...baseOptions,
			mode: { kind: 'review', parameters: {} },
			checkStatus: status([
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'failure' },
			]),
		});

		expect(decision).toEqual({ action: 'respond-to-ci' });
	});

	it('returns defer for incomplete checks with the existing skip message text', () => {
		const decision = decideCheckSuiteOutcome({
			...baseOptions,
			mode: { kind: 'review', parameters: {} },
			checkStatus: status([
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'in_progress', conclusion: null },
			]),
		});

		expect(decision).toEqual({
			action: 'defer',
			incompleteChecks: ['test'],
			message: 'Not all checks complete yet (1/2 still running): test',
		});
	});

	it('returns review for all-complete passing aggregate state', () => {
		const decision = decideCheckSuiteOutcome({
			...baseOptions,
			mode: { kind: 'review', parameters: {} },
			checkStatus: status([
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'neutral' },
			]),
		});

		expect(decision).toEqual({ action: 'review' });
	});

	it('returns author-mode skip before aggregate decisions', () => {
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prAuthorLogin: 'cascade-impl',
			mode: { kind: 'review', parameters: { authorMode: 'external' } },
		});

		expect(decision).toEqual({
			action: 'skip',
			message:
				"PR #42 author cascade-impl does not match configured authorMode 'external' (isCascadePR=true)",
		});
	});

	it('returns base-branch skip for non-cascade-authored PR targeting a non-canonical branch', () => {
		// Non-cascade authors hitting an unrelated branch are still rejected —
		// the gate exists to filter human-authored / third-party-bot drive-bys
		// against random branches in the repo.
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prAuthorLogin: 'random-contributor',
			prBaseRef: 'develop',
			mode: { kind: 'review', parameters: { authorMode: 'all' } },
		});

		expect(decision).toEqual({
			action: 'skip',
			message: 'PR #42 targets develop, not project base branch main',
		});
	});

	// Bug 2 (2026-05-11 prod incident on ucho PR #393, MNG-691):
	// stacked PRs targeting a feature branch (MNG-691 → MNG-690's branch)
	// were rejected by the base-branch gate even though the PR was opened
	// by the cascade implementer. The persona check upstream already trusts
	// these — the base-branch check adds no value for that case.
	it('allows cascade-authored stacked PR through the base-branch gate (Bug 2)', () => {
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prAuthorLogin: 'cascade-impl', // matches mockPersonaIdentities.implementer
			prBaseRef: 'feature/MNG-690-calendar-event-context-tables',
			mode: { kind: 'review', parameters: {} },
		});

		expect(decision).toBeNull();
	});

	it('preserves the existing pass-through for cascade-authored canonical PRs', () => {
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prAuthorLogin: 'cascade-impl',
			prBaseRef: 'main', // canonical base
			mode: { kind: 'review', parameters: {} },
		});

		expect(decision).toBeNull();
	});

	// MNG-1774: respond-to-ci mode now carries authorMode parameters and routes
	// through the same shared author-mode evaluator as review mode.
	describe('respond-to-ci mode (MNG-1774)', () => {
		const respondBase = {
			...baseOptions,
			handlerName: 'check-suite-failure',
		} as const;

		it("skips a cascade-authored PR under respond-to-ci authorMode 'external'", () => {
			const decision = decideCheckSuiteGates({
				...respondBase,
				prAuthorLogin: 'cascade-impl',
				mode: { kind: 'respond-to-ci', parameters: { authorMode: 'external' } },
			});

			expect(decision).toEqual({
				action: 'skip',
				message:
					"PR #42 author cascade-impl does not match configured authorMode 'external' (isCascadePR=true)",
			});
		});

		it("passes a human-authored PR under respond-to-ci authorMode 'all'", () => {
			const decision = decideCheckSuiteGates({
				...respondBase,
				prAuthorLogin: 'random-contributor',
				mode: { kind: 'respond-to-ci', parameters: { authorMode: 'all' } },
			});

			expect(decision).toBeNull();
		});

		it("skips a human-authored PR under respond-to-ci authorMode 'own' (default)", () => {
			const decision = decideCheckSuiteGates({
				...respondBase,
				prAuthorLogin: 'random-contributor',
				mode: { kind: 'respond-to-ci', parameters: {} },
			});

			expect(decision).toEqual({
				action: 'skip',
				message:
					"PR #42 author random-contributor does not match configured authorMode 'own' (isCascadePR=false)",
			});
		});

		it('still returns the "all passed — no action" skip for respond-to-ci when every check passes', () => {
			const decision = decideCheckSuiteOutcome({
				...respondBase,
				prAuthorLogin: 'cascade-impl',
				mode: { kind: 'respond-to-ci', parameters: {} },
				checkStatus: status([
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				]),
			});

			expect(decision).toEqual({
				action: 'skip',
				message: 'All 2 checks passed for PR #42 — no action needed',
			});
		});

		it('returns respond-to-ci for a mixed aggregate under respond-to-ci mode', () => {
			const decision = decideCheckSuiteOutcome({
				...respondBase,
				prAuthorLogin: 'cascade-impl',
				mode: { kind: 'respond-to-ci', parameters: {} },
				checkStatus: status([
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				]),
			});

			expect(decision).toEqual({ action: 'respond-to-ci' });
		});
	});

	it('rejects cascade-authored stacked PR if persona identities cannot be resolved', () => {
		// Defense in depth: with no personaIdentities, isCascadeBot is unreliable.
		// The author-mode gate already returns its own skip in that case (see
		// cascadePersonaDecision); this assertion pins that we never grant the
		// stacked-PR bypass on a degraded identity path.
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prAuthorLogin: 'cascade-impl',
			prBaseRef: 'feature/MNG-690-x',
			personaIdentities: undefined,
			mode: { kind: 'review', parameters: {} },
		});

		// The persona-failure skip from authorModeDecision takes precedence.
		expect(decision?.action).toBe('skip');
		expect((decision as { action: 'skip'; message: string }).message).toMatch(
			/Cascade persona identities could not be resolved/,
		);
	});
});

describe('resolveCheckSuitePRNumber', () => {
	const baseOptions = {
		owner: 'owner',
		repo: 'repo',
		handlerName: 'check-suite-failure',
		lookupOpenPRByBranch: vi.fn(),
	};

	it('resolves direct PR payloads without branch lookup', async () => {
		const lookupOpenPRByBranch = vi.fn();

		await expect(
			resolveCheckSuitePRNumber({
				...baseOptions,
				pullRequests: [{ number: 42 }],
				headBranch: 'feature/test',
				lookupOpenPRByBranch,
			}),
		).resolves.toEqual({ ok: true, prNumber: 42 });
		expect(lookupOpenPRByBranch).not.toHaveBeenCalled();
	});

	it('resolves refs/pull/N/head without branch lookup', async () => {
		const lookupOpenPRByBranch = vi.fn();

		await expect(
			resolveCheckSuitePRNumber({
				...baseOptions,
				pullRequests: [],
				headBranch: 'refs/pull/77/head',
				lookupOpenPRByBranch,
			}),
		).resolves.toEqual({ ok: true, prNumber: 77 });
		expect(lookupOpenPRByBranch).not.toHaveBeenCalled();
	});

	it('falls back to open PR lookup for plain branch names', async () => {
		const lookupOpenPRByBranch = vi.fn().mockResolvedValue({
			number: 99,
			htmlUrl: 'https://github.com/owner/repo/pull/99',
			title: 'Branch PR',
		});

		await expect(
			resolveCheckSuitePRNumber({
				...baseOptions,
				pullRequests: [],
				headBranch: 'feature/test',
				lookupOpenPRByBranch,
			}),
		).resolves.toEqual({ ok: true, prNumber: 99 });
		expect(lookupOpenPRByBranch).toHaveBeenCalledWith('owner', 'repo', 'feature/test');
	});

	it('returns unresolved when no branch fallback can find a PR', async () => {
		const lookupOpenPRByBranch = vi.fn().mockResolvedValue(null);

		await expect(
			resolveCheckSuitePRNumber({
				...baseOptions,
				pullRequests: [],
				headBranch: 'main',
				lookupOpenPRByBranch,
			}),
		).resolves.toEqual({ ok: false, reason: 'unresolved' });
	});
});
