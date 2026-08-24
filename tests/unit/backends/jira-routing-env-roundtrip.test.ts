/**
 * Spec 024 — the routing discriminator must survive the worker env hop.
 *
 * `cascade-tools` commands do NOT read the database. `CredentialScopedCommand`
 * rebuilds the project from environment variables via `synthesizeProjectFromEnv`,
 * so a field `augmentProjectSecrets` does not emit simply does not exist inside
 * the worker — and `JiraPMProvider` then stamps nothing on the work items an
 * agent creates and scopes nothing on the ones it lists.
 *
 * That is a silent, permanent misroute on a shared board: an issue created
 * without the discriminator matches no sibling and is handed to the key's
 * DEFAULT project, so one team's work quietly becomes another's.
 *
 * This drives the REAL projection in both directions — the actual
 * `augmentProjectSecrets` output into the actual `synthesizeProjectFromEnv` —
 * because a hand-built config on either side would prove only that the shapes
 * I wrote agree with each other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/provider.js', () => ({
	// A fresh object per call: `augmentProjectSecrets` MUTATES what this returns,
	// so a shared `mockResolvedValue({})` instance would carry one test's env
	// vars into the next and make the "emits nothing" assertion pass or fail on
	// test order rather than on behaviour.
	getAllProjectCredentials: vi.fn().mockImplementation(async () => ({})),
}));
vi.mock('../../../src/github/personas.js', () => ({ getPersonaToken: vi.fn() }));

import { augmentProjectSecrets } from '../../../src/backends/secretBuilder.js';
import { synthesizeProjectFromEnv } from '../../../src/cli/base.js';
import type { AgentInput, ProjectConfig } from '../../../src/types/index.js';

const projectWith = (routing?: { discriminator: { kind: string; value: string } }): ProjectConfig =>
	({
		id: 'backend',
		name: 'Backend',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'SHARED',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { todo: '10001' },
			...(routing ? { routing } : {}),
		},
	}) as ProjectConfig;

const INPUT = { workItemId: 'SHARED-1' } as AgentInput;

/** Push the emitted secrets into the environment the CLI actually reads. */
async function roundTrip(project: ProjectConfig) {
	const secrets = await augmentProjectSecrets(project, 'implementation', INPUT);
	for (const [k, v] of Object.entries(secrets)) {
		if (k.startsWith('CASCADE_JIRA')) vi.stubEnv(k, v);
	}
	return { secrets, rebuilt: synthesizeProjectFromEnv('jira') };
}

describe('JIRA routing discriminator survives the worker env hop', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubEnv('CASCADE_JIRA_PROJECT_KEY', '');
		vi.stubEnv('CASCADE_JIRA_BASE_URL', '');
		vi.stubEnv('CASCADE_JIRA_AUTH_TYPE', '');
		vi.stubEnv('CASCADE_JIRA_STATUSES', '');
	});

	it('carries a label discriminator into the worker', async () => {
		const { rebuilt } = await roundTrip(
			projectWith({ discriminator: { kind: 'label', value: 'team-be' } }),
		);

		expect(rebuilt.jira?.routing).toEqual({
			discriminator: { kind: 'label', value: 'team-be' },
		});
	});

	it('carries a component discriminator into the worker', async () => {
		const { rebuilt } = await roundTrip(
			projectWith({ discriminator: { kind: 'component', value: 'Payments API' } }),
		);

		expect(rebuilt.jira?.routing).toEqual({
			discriminator: { kind: 'component', value: 'Payments API' },
		});
	});

	it('emits nothing for a project without a discriminator', async () => {
		// Every project that does not share a board. The worker env must be
		// byte-identical to before spec 024 for them.
		const { secrets, rebuilt } = await roundTrip(projectWith());

		expect(secrets).not.toHaveProperty('CASCADE_JIRA_ROUTING');
		expect(rebuilt.jira?.routing).toBeUndefined();
	});

	it('leaves the other JIRA fields intact', async () => {
		// Guards against the fix perturbing the hop it is threading through.
		const { rebuilt } = await roundTrip(
			projectWith({ discriminator: { kind: 'label', value: 'team-be' } }),
		);

		expect(rebuilt.jira?.projectKey).toBe('SHARED');
		expect(rebuilt.jira?.baseUrl).toBe('https://acme.atlassian.net');
		expect(rebuilt.jira?.statuses).toEqual({ todo: '10001' });
	});

	it('survives a malformed env value without crashing the agent', async () => {
		// The var is JSON; a truncated or hand-edited value must degrade to "no
		// discriminator" rather than throw inside every cascade-tools invocation.
		vi.stubEnv('CASCADE_JIRA_ROUTING', '{not json');

		expect(() => synthesizeProjectFromEnv('jira')).not.toThrow();
		expect(synthesizeProjectFromEnv('jira').jira?.routing).toBeUndefined();
	});
});
