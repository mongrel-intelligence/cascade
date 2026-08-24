/**
 * Spec 024 plan 5 — the operator surface for the JIRA routing discriminator.
 *
 * Plans 1-4 made shared boards route, scope, and stamp correctly, but nothing
 * could SET a discriminator: `buildIntegrationConfig` rebuilds the config from
 * wizard state, so a value written out-of-band was wiped by the next save. Until
 * this exists, sharing a board is configurable only in theory.
 *
 * Reducer/serialization level, matching the other wizard suites — no DOM.
 */
import { describe, expect, it } from 'vitest';
import { jiraConfigSchema } from '../../../src/integrations/pm/jira/config-schema.js';
import {
	createInitialJiraState,
	jiraWizardReducer,
} from '../../../web/src/components/projects/pm-providers/jira/state.js';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';

const baseState = () => ({
	...createInitialJiraState(),
	verificationResult: null,
	verifyError: null,
});

const withDiscriminator = (kind: 'label' | 'component', value: string) =>
	jiraWizardReducer(baseState(), {
		type: 'SET_JIRA_ROUTING_DISCRIMINATOR',
		kind,
		value,
	} as never);

/** The wizard state shape `buildIntegrationConfig` consumes. */
const configFrom = (state: ReturnType<typeof baseState>) =>
	jiraProviderWizard.buildIntegrationConfig({
		...state,
		jiraProjectKey: 'SHARED',
		jiraBaseUrl: 'https://t.atlassian.net',
	} as never) as Record<string, unknown>;

describe('JIRA routing discriminator — wizard state', () => {
	it('stores the kind and value', () => {
		const next = withDiscriminator('label', 'team-be');

		expect(next.jiraRoutingKind).toBe('label');
		expect(next.jiraRoutingValue).toBe('team-be');
	});

	it('clears the discriminator when the value is emptied', () => {
		// A half-configured discriminator must not persist: a kind with no value
		// would serialise to a routing block the backend schema rejects, and the
		// operator's intent when clearing the field is plainly "no scoping".
		const set = withDiscriminator('label', 'team-be');
		const cleared = jiraWizardReducer(set, {
			type: 'SET_JIRA_ROUTING_DISCRIMINATOR',
			kind: 'label',
			value: '',
		} as never);

		expect(cleared.jiraRoutingValue).toBe('');
		expect(configFrom(cleared)).not.toHaveProperty('routing');
	});

	it('defaults to no discriminator', () => {
		expect(createInitialJiraState().jiraRoutingKind).toBe('');
		expect(createInitialJiraState().jiraRoutingValue).toBe('');
	});
});

describe('JIRA routing discriminator — config serialization', () => {
	it('omits routing entirely when unset', () => {
		// AC #12 pin: every existing JIRA project saves a config byte-identical
		// to before this plan.
		expect(configFrom(baseState())).not.toHaveProperty('routing');
	});

	it('emits a routing block the backend schema accepts', () => {
		const config = configFrom(withDiscriminator('label', 'team-be'));

		expect(config.routing).toEqual({ discriminator: { kind: 'label', value: 'team-be' } });
		// Round-trips the real schema rather than a hand-written shape, so the
		// wizard cannot drift from what the backend will accept.
		expect(jiraConfigSchema.safeParse(config).success).toBe(true);
	});

	it('emits a component discriminator', () => {
		const config = configFrom(withDiscriminator('component', 'Payments API'));

		expect(config.routing).toEqual({
			discriminator: { kind: 'component', value: 'Payments API' },
		});
		expect(jiraConfigSchema.safeParse(config).success).toBe(true);
	});

	it('does not emit a value the backend would reject', () => {
		// The schema forbids whitespace in a LABEL discriminator (JIRA refuses to
		// write such a label). The wizard must not produce a config that fails
		// save-time validation with a message the operator cannot act on.
		const config = configFrom(withDiscriminator('label', 'team be'));

		expect(jiraConfigSchema.safeParse(config).success).toBe(false);
	});
});

describe('JIRA routing discriminator — edit hydration', () => {
	it('restores a saved discriminator', () => {
		const state = jiraProviderWizard.buildEditState(
			{
				projectKey: 'SHARED',
				baseUrl: 'https://t.atlassian.net',
				routing: { discriminator: { kind: 'component', value: 'Backend' } },
			} as never,
			new Set<string>(),
		) as Record<string, unknown>;

		expect(state.jiraRoutingKind).toBe('component');
		expect(state.jiraRoutingValue).toBe('Backend');
	});

	it('leaves the fields empty for a config without routing', () => {
		const state = jiraProviderWizard.buildEditState(
			{ projectKey: 'SHARED', baseUrl: 'https://t.atlassian.net' } as never,
			new Set<string>(),
		) as Record<string, unknown>;

		expect(state.jiraRoutingKind).toBe('');
		expect(state.jiraRoutingValue).toBe('');
	});

	it('survives a save → edit → save round trip', () => {
		// The bug this plan closes: a discriminator that does not survive
		// buildIntegrationConfig is silently wiped by the next wizard save,
		// turning a scoped project back into the key's default.
		const saved = configFrom(withDiscriminator('label', 'team-be'));
		const hydrated = jiraProviderWizard.buildEditState(saved as never, new Set<string>());
		const resaved = configFrom({ ...baseState(), ...hydrated } as never);

		expect(resaved.routing).toEqual(saved.routing);
	});
});
