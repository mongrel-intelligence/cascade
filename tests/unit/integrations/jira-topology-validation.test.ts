/**
 * Spec 024 plan 2 — save-time rejection of unroutable JIRA topologies.
 *
 * Routing can only be as good as the configuration it reads. Two projects on
 * one key with no way to tell their issues apart is not a routing problem to be
 * solved at webhook time — it is a configuration that should never have been
 * saveable. Before this plan it saved fine and the second project simply never
 * received an event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../helpers/mockDb.js';
import { mockDbClientModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/db/client.js', () => mockDbClientModule);

import { upsertProjectIntegration } from '../../../src/db/repositories/integrationsRepository.js';
import {
	assertJiraTopologyValid,
	type JiraTopologySibling,
} from '../../../src/integrations/pm/_shared/topology-validation.js';

const KEY = 'SHARED';
const label = (value: string) => ({ kind: 'label' as const, value });
const component = (value: string) => ({ kind: 'component' as const, value });

const sibling = (
	projectId: string,
	discriminator: { kind: 'label' | 'component'; value: string } | null,
): JiraTopologySibling => ({
	projectId,
	config: { projectKey: KEY, ...(discriminator ? { routing: { discriminator } } : {}) },
});

const configFor = (discriminator: { kind: 'label' | 'component'; value: string } | null) => ({
	projectKey: KEY,
	...(discriminator ? { routing: { discriminator } } : {}),
});

describe('assertJiraTopologyValid', () => {
	it('accepts the first project on a key', () => {
		expect(() => assertJiraTopologyValid('frontend', configFor(null), [])).not.toThrow();
	});

	it('rejects a second project on the key with no discriminator', () => {
		expect(() =>
			assertJiraTopologyValid('backend', configFor(null), [sibling('frontend', null)]),
		).toThrow(/frontend/);
	});

	it('names the discriminator in the rejection so the fix is obvious', () => {
		// The operator sees this message in the wizard; "invalid configuration"
		// would leave them exactly as stuck as the silent shadowing did.
		expect(() =>
			assertJiraTopologyValid('backend', configFor(null), [sibling('frontend', null)]),
		).toThrow(/discriminator/i);
	});

	it('accepts a second project that brings a distinct discriminator', () => {
		// The discriminator-less sibling becomes the key's default.
		expect(() =>
			assertJiraTopologyValid('backend', configFor(label('team-be')), [sibling('frontend', null)]),
		).not.toThrow();
	});

	it('rejects a duplicate discriminator, naming both projects', () => {
		let message = '';
		try {
			assertJiraTopologyValid('backend', configFor(label('team-be')), [
				sibling('frontend', label('team-be')),
			]);
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toContain('frontend');
		expect(message).toContain('team-be');
	});

	it('rejects a third project when a default already exists', () => {
		expect(() =>
			assertJiraTopologyValid('mobile', configFor(null), [
				sibling('frontend', null),
				sibling('backend', label('team-be')),
			]),
		).toThrow(/frontend/);
	});

	it('accepts same-kind different-value discriminators', () => {
		expect(() =>
			assertJiraTopologyValid('backend', configFor(label('team-be')), [
				sibling('frontend', label('team-fe')),
			]),
		).not.toThrow();
	});

	it('accepts a label and a component that happen to share a value', () => {
		// Different attribute namespaces — a label "Web" and a component "Web"
		// are distinct facts about an issue, so they cannot collide.
		expect(() =>
			assertJiraTopologyValid('backend', configFor(component('Web')), [
				sibling('frontend', label('Web')),
			]),
		).not.toThrow();
	});

	it('ignores the project being edited when it is already among the siblings', () => {
		// Re-saving an existing project must not conflict with itself.
		expect(() =>
			assertJiraTopologyValid('frontend', configFor(label('team-fe')), [
				sibling('frontend', label('team-fe')),
				sibling('backend', label('team-be')),
			]),
		).not.toThrow();
	});
});

describe('upsertProjectIntegration topology guard', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockDb = createMockDbWithGetDb({ withUpsert: true, withThenable: true });
	});

	it('rejects a conflicting JIRA save before writing anything', async () => {
		mockDb.chain.where.mockResolvedValue([{ projectId: 'frontend', config: { projectKey: KEY } }]);

		await expect(
			upsertProjectIntegration('backend', 'pm', 'jira', { projectKey: KEY }, {}),
		).rejects.toThrow(/frontend/);
		expect(mockDb.db.insert).not.toHaveBeenCalled();
	});

	it('writes when the topology is valid', async () => {
		mockDb.chain.where.mockResolvedValue([]);
		mockDb.chain.returning.mockResolvedValue([{ id: 1 }]);

		await upsertProjectIntegration('frontend', 'pm', 'jira', { projectKey: KEY }, {});

		expect(mockDb.db.insert).toHaveBeenCalled();
	});

	it('leaves non-JIRA upserts untouched', async () => {
		// AC #12 pin: SCM and other PM providers must not gain a sibling query.
		mockDb.chain.where.mockResolvedValue([]);
		mockDb.chain.returning.mockResolvedValue([{ id: 1 }]);

		await upsertProjectIntegration('frontend', 'scm', 'github', { repo: 'a/b' }, {});

		expect(mockDb.db.insert).toHaveBeenCalled();
	});
});
