/**
 * Integration tests: GitHub Dual-Persona System
 *
 * Tests implementer/reviewer token resolution, bot detection, and review trigger
 * modes with real DB-backed project configurations.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { findProjectByRepoFromDb } from '../../src/db/repositories/configRepository.js';
import { resolveIntegrationCredential } from '../../src/db/repositories/credentialsRepository.js';
import {
	type PersonaIdentities,
	getPersonaForAgentType,
	getPersonaForLogin,
	isCascadeBot,
} from '../../src/github/personas.js';
import { PRReviewSubmittedTrigger } from '../../src/triggers/github/pr-review-submitted.js';
import { ReviewRequestedTrigger } from '../../src/triggers/github/review-requested.js';
import type { TriggerContext } from '../../src/types/index.js';
import { assertFound } from './helpers/assert.js';
import { truncateAll } from './helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
	seedTriggerConfig,
} from './helpers/seed.js';

// ============================================================================
// Helpers
// ============================================================================

const TEST_PERSONAS: PersonaIdentities = {
	implementer: 'cascade-impl-bot',
	reviewer: 'cascade-review-bot',
};

function makePRReviewPayload(overrides: {
	reviewerLogin: string;
	state?: string;
	prNumber?: number;
	action?: string;
}) {
	return {
		action: overrides.action ?? 'submitted',
		review: {
			id: 1,
			state: overrides.state ?? 'changes_requested',
			body: 'Please fix this',
			html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
			user: { login: overrides.reviewerLogin },
		},
		pull_request: {
			number: overrides.prNumber ?? 1,
			title: 'Test PR',
			body: null,
			html_url: 'https://github.com/owner/repo/pull/1',
			head: { ref: 'feature/test', sha: 'abc123' },
			base: { ref: 'main' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: overrides.reviewerLogin },
	};
}

function makeReviewRequestedPayload(requestedReviewer: string, prAuthor: string) {
	return {
		action: 'review_requested',
		number: 42,
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: null,
			html_url: 'https://github.com/owner/repo/pull/42',
			state: 'open',
			draft: false,
			head: { ref: 'feature/test', sha: 'abc123' },
			base: { ref: 'main' },
			user: { login: prAuthor },
			requested_reviewers: [{ login: requestedReviewer }],
		},
		requested_reviewer: { login: requestedReviewer },
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: prAuthor },
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('GitHub Dual-Persona System (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject({ repo: 'owner/repo' });
	});

	// =========================================================================
	// Token Resolution
	// =========================================================================

	describe('persona token resolution from DB', () => {
		it('resolves implementer token via SCM integration', async () => {
			const implCred = await seedCredential({
				name: 'Implementer Token',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'ghp-impl-secret',
			});
			const scmInteg = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'implementer_token',
				credentialId: implCred.id,
			});

			const token = await resolveIntegrationCredential('test-project', 'scm', 'implementer_token');
			expect(token).toBe('ghp-impl-secret');
		});

		it('resolves reviewer token via SCM integration', async () => {
			const reviewerCred = await seedCredential({
				name: 'Reviewer Token',
				envVarKey: 'GITHUB_TOKEN_REVIEWER',
				value: 'ghp-reviewer-secret',
			});
			const scmInteg = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'reviewer_token',
				credentialId: reviewerCred.id,
			});

			const token = await resolveIntegrationCredential('test-project', 'scm', 'reviewer_token');
			expect(token).toBe('ghp-reviewer-secret');
		});

		it('returns null when reviewer token not configured', async () => {
			// Only implementer token set up
			const implCred = await seedCredential({
				name: 'Implementer Token',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'ghp-impl-secret',
			});
			const scmInteg = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'implementer_token',
				credentialId: implCred.id,
			});

			const reviewerToken = await resolveIntegrationCredential(
				'test-project',
				'scm',
				'reviewer_token',
			);
			expect(reviewerToken).toBeNull();
		});
	});

	// =========================================================================
	// Bot Detection
	// =========================================================================

	describe('isCascadeBot', () => {
		it('identifies implementer login as cascade bot', () => {
			expect(isCascadeBot('cascade-impl-bot', TEST_PERSONAS)).toBe(true);
		});

		it('identifies reviewer login as cascade bot', () => {
			expect(isCascadeBot('cascade-review-bot', TEST_PERSONAS)).toBe(true);
		});

		it('identifies [bot] suffix variants as cascade bot', () => {
			expect(isCascadeBot('cascade-impl-bot[bot]', TEST_PERSONAS)).toBe(true);
			expect(isCascadeBot('cascade-review-bot[bot]', TEST_PERSONAS)).toBe(true);
		});

		it('rejects external users as non-bot', () => {
			expect(isCascadeBot('external-user', TEST_PERSONAS)).toBe(false);
			expect(isCascadeBot('some-contributor', TEST_PERSONAS)).toBe(false);
			expect(isCascadeBot('', TEST_PERSONAS)).toBe(false);
		});
	});

	// =========================================================================
	// Persona Identification
	// =========================================================================

	describe('getPersonaForLogin', () => {
		it('returns implementer for implementer login', () => {
			expect(getPersonaForLogin('cascade-impl-bot', TEST_PERSONAS)).toBe('implementer');
			expect(getPersonaForLogin('cascade-impl-bot[bot]', TEST_PERSONAS)).toBe('implementer');
		});

		it('returns reviewer for reviewer login', () => {
			expect(getPersonaForLogin('cascade-review-bot', TEST_PERSONAS)).toBe('reviewer');
			expect(getPersonaForLogin('cascade-review-bot[bot]', TEST_PERSONAS)).toBe('reviewer');
		});

		it('returns null for unknown login', () => {
			expect(getPersonaForLogin('external-user', TEST_PERSONAS)).toBeNull();
		});
	});

	// =========================================================================
	// Agent-to-Persona Mapping
	// =========================================================================

	describe('getPersonaForAgentType', () => {
		const implementerAgents = [
			'splitting',
			'planning',
			'implementation',
			'respond-to-review',
			'respond-to-ci',
			'respond-to-pr-comment',
			'respond-to-planning-comment',
			'debug',
		];

		for (const agentType of implementerAgents) {
			it(`maps ${agentType} to implementer persona`, () => {
				expect(getPersonaForAgentType(agentType)).toBe('implementer');
			});
		}

		it('maps review to reviewer persona', () => {
			expect(getPersonaForAgentType('review')).toBe('reviewer');
		});

		it('defaults unknown agent to implementer', () => {
			expect(getPersonaForAgentType('unknown-custom-agent')).toBe('implementer');
		});
	});

	// =========================================================================
	// Loop Prevention: PRReviewSubmittedTrigger
	// =========================================================================

	describe('PRReviewSubmittedTrigger loop prevention', () => {
		it('handles trigger only from reviewer persona', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
				triggers: { prReviewSubmitted: true },
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new PRReviewSubmittedTrigger();

			// Reviewer persona submits changes_requested — should match
			const reviewerPayload = makePRReviewPayload({
				reviewerLogin: TEST_PERSONAS.reviewer,
				state: 'changes_requested',
			});

			const ctxFromReviewer: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload: reviewerPayload,
				personaIdentities: TEST_PERSONAS,
			};

			expect(trigger.matches(ctxFromReviewer)).toBe(true);
			const result = await trigger.handle(ctxFromReviewer);
			expect(result?.agentType).toBe('respond-to-review');
		});

		it('skips review when submitted by implementer persona (loop prevention)', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
				triggers: { prReviewSubmitted: true },
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new PRReviewSubmittedTrigger();

			// Implementer somehow submits a review — should NOT trigger
			const implPayload = makePRReviewPayload({
				reviewerLogin: TEST_PERSONAS.implementer,
				state: 'changes_requested',
			});

			const ctxFromImpl: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload: implPayload,
				personaIdentities: TEST_PERSONAS,
			};

			// matches() returns true (persona checks are in handle()), but handle() returns null
			// because the implementer is not the reviewer persona
			expect(trigger.matches(ctxFromImpl)).toBe(true);
			const result = await trigger.handle(ctxFromImpl);
			expect(result).toBeNull();
		});

		it('skips approved reviews (only changes_requested triggers respond-to-review)', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
				triggers: { prReviewSubmitted: true },
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new PRReviewSubmittedTrigger();

			const approvedPayload = makePRReviewPayload({
				reviewerLogin: TEST_PERSONAS.reviewer,
				state: 'approved',
			});

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload: approvedPayload,
				personaIdentities: TEST_PERSONAS,
			};

			// Approved reviews don't trigger respond-to-review
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	// =========================================================================
	// Review Trigger Modes
	// =========================================================================

	describe('ReviewRequestedTrigger', () => {
		it('returns null from handle() when scm:review-requested is disabled (default)', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new ReviewRequestedTrigger();

			const payload = makeReviewRequestedPayload(TEST_PERSONAS.reviewer, 'external-user');
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload,
				personaIdentities: TEST_PERSONAS,
			};

			// matches() checks payload shape (returns true), handle() checks DB config
			// scm:review-requested has defaultEnabled: false in definition
			expect(trigger.matches(ctx)).toBe(true);
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('triggers review when enabled via DB and persona is requested', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
			});
			await seedTriggerConfig({
				agentType: 'review',
				triggerEvent: 'scm:review-requested',
				enabled: true,
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new ReviewRequestedTrigger();

			const payload = makeReviewRequestedPayload(TEST_PERSONAS.reviewer, 'external-user');
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload,
				personaIdentities: TEST_PERSONAS,
			};

			expect(trigger.matches(ctx)).toBe(true);
			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('review');
		});

		it('returns null when non-persona reviewer is requested', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
			});
			await seedTriggerConfig({
				agentType: 'review',
				triggerEvent: 'scm:review-requested',
				enabled: true,
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			const trigger = new ReviewRequestedTrigger();

			const payload = makeReviewRequestedPayload('external-reviewer', 'pr-author');
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload,
				personaIdentities: TEST_PERSONAS,
			};

			// external-reviewer is not a known persona — matches() passes (persona check is in handle())
			// but handle() returns null because the requested reviewer isn't a CASCADE bot
			expect(trigger.matches(ctx)).toBe(true);
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});
});
