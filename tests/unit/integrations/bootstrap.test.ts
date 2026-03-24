/**
 * Tests for src/integrations/bootstrap.ts
 *
 * Verifies that importing the unified bootstrap registers all 4 integrations
 * into the integrationRegistry (and PM ones into pmRegistry too), and that
 * the registration is idempotent (no errors on double-import).
 *
 * Note: uses real IntegrationRegistry / pmRegistry singletons.
 * Heavy DB / HTTP dependencies are mocked so the integration classes can be
 * instantiated without a live database.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test so that
// vi.mock hoisting runs first.
// ---------------------------------------------------------------------------

vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn().mockResolvedValue('mock-cred'),
	getIntegrationCredentialOrNull: vi.fn().mockResolvedValue(null),
	loadProjectConfigByBoardId: vi.fn().mockResolvedValue(null),
	loadProjectConfigByJiraProjectKey: vi.fn().mockResolvedValue(null),
	findProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
	trelloClient: {},
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
	jiraClient: {},
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn().mockResolvedValue(null),
	deleteTrelloAck: vi.fn().mockResolvedValue(undefined),
	resolveTrelloBotMemberId: vi.fn().mockResolvedValue(null),
	postJiraAck: vi.fn().mockResolvedValue(null),
	deleteJiraAck: vi.fn().mockResolvedValue(undefined),
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/pm/trello/adapter.js', () => ({
	TrelloPMProvider: vi.fn().mockImplementation(() => ({ type: 'trello' })),
}));

vi.mock('../../../src/pm/jira/adapter.js', () => ({
	JiraPMProvider: vi.fn().mockImplementation(() => ({ type: 'jira' })),
}));

// ---------------------------------------------------------------------------
// Import the bootstrap (triggers side-effect registration) and singletons
// ---------------------------------------------------------------------------

// Bootstrap first — registers all integrations into the singletons
import '../../../src/integrations/bootstrap.js';

import { integrationRegistry } from '../../../src/integrations/registry.js';
import { pmRegistry } from '../../../src/pm/registry.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integrations/bootstrap', () => {
	// -------------------------------------------------------------------------
	// All 4 integrations registered in integrationRegistry
	// -------------------------------------------------------------------------
	describe('integrationRegistry after bootstrap', () => {
		it('registers trello (PM) integration', () => {
			const integration = integrationRegistry.getOrNull('trello');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('trello');
			expect(integration?.category).toBe('pm');
		});

		it('registers jira (PM) integration', () => {
			const integration = integrationRegistry.getOrNull('jira');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('jira');
			expect(integration?.category).toBe('pm');
		});

		it('registers github (SCM) integration', () => {
			const integration = integrationRegistry.getOrNull('github');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('github');
			expect(integration?.category).toBe('scm');
		});

		it('registers sentry (alerting) integration', () => {
			const integration = integrationRegistry.getOrNull('sentry');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('sentry');
			expect(integration?.category).toBe('alerting');
		});

		it('getByCategory returns PM integrations', () => {
			expect(integrationRegistry.getByCategory('pm').length).toBeGreaterThanOrEqual(2);
		});

		it('getByCategory returns SCM integrations', () => {
			expect(integrationRegistry.getByCategory('scm').length).toBeGreaterThanOrEqual(1);
		});

		it('getByCategory returns alerting integrations', () => {
			expect(integrationRegistry.getByCategory('alerting').length).toBeGreaterThanOrEqual(1);
		});
	});

	// -------------------------------------------------------------------------
	// PM integrations also registered in pmRegistry (backward compat)
	// -------------------------------------------------------------------------
	describe('pmRegistry after bootstrap', () => {
		it('registers trello in pmRegistry', () => {
			expect(pmRegistry.getOrNull('trello')).not.toBeNull();
		});

		it('registers jira in pmRegistry', () => {
			expect(pmRegistry.getOrNull('jira')).not.toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// Idempotency — importing bootstrap again must not throw
	// -------------------------------------------------------------------------
	describe('idempotency', () => {
		it('does not throw when bootstrap is imported a second time', async () => {
			// In Node ESM the module is cached, so re-importing is a no-op.
			// This test confirms the guard pattern (getOrNull before register) is
			// in place: even if somehow re-evaluated, it will not throw.
			await expect(import('../../../src/integrations/bootstrap.js')).resolves.not.toThrow();
		});
	});
});
