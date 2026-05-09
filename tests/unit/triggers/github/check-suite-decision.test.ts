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

	it('returns base-branch skip before aggregate decisions', () => {
		const decision = decideCheckSuiteGates({
			...baseOptions,
			prBaseRef: 'develop',
			mode: { kind: 'review', parameters: {} },
		});

		expect(decision).toEqual({
			action: 'skip',
			message: 'PR #42 targets develop, not project base branch main',
		});
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
