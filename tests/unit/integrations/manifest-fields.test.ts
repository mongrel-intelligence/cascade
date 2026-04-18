/**
 * Tests the plan-009/1 additions to PMProviderManifest:
 *   - `configSchema?: ZodType` — round-trippable persisted config shape
 *   - `discoveryCapabilities?` — declared set of discovery capabilities
 *   - `wizardSpec?` — declarative list of standard wizard steps
 *   - `lifecycle?` — opt-in flag for the behavioral conformance lifecycle
 *     scenario; see plan 009/1 task 7.
 *
 * All four fields are optional so existing manifests (Trello, JIRA, Linear,
 * TestProvider) compile unchanged. Migration plans 2/3/4 opt each real
 * provider in.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type {
	DiscoveryCapabilitiesMap,
	PMProviderManifest,
	StandardStepKind,
	WizardSpec,
} from '../../../src/integrations/pm/manifest.js';
import { testPMProvider } from '../../helpers/testPMProvider.js';

describe('PMProviderManifest — additive optional fields', () => {
	it('existing manifest without new fields still satisfies the type', () => {
		// testPMProvider does not declare configSchema / discoveryCapabilities /
		// wizardSpec / lifecycle. The fact that it still compiles under
		// PMProviderManifest is the assertion — both at compile time and at
		// runtime (via the import succeeding).
		const m: PMProviderManifest = testPMProvider;
		expect(m.id).toBe('test-provider');
		expect(m.configSchema).toBeUndefined();
		expect(m.discoveryCapabilities).toBeUndefined();
		expect(m.wizardSpec).toBeUndefined();
		expect(m.lifecycle).toBeUndefined();
	});

	it('configSchema is a Zod schema when declared', () => {
		const schema = z.object({ apiKey: z.string(), projectId: z.string().optional() });
		type Config = z.infer<typeof schema>;

		// A manifest declaring `configSchema` is round-trippable: parsing,
		// stringifying, and re-parsing yields a deep-equal config.
		const raw: Config = { apiKey: 'k', projectId: 'p' };
		const parsed1 = schema.parse(raw);
		const parsed2 = schema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it('DiscoveryCapabilitiesMap permits any subset of the capability union', () => {
		expectTypeOf<DiscoveryCapabilitiesMap>().toMatchTypeOf<{
			teams?: true;
			boards?: true;
			labels?: true;
			states?: true;
			projects?: true;
			customFields?: true;
			containers?: true;
		}>();
	});

	it('StandardStepKind is the expected union', () => {
		expectTypeOf<StandardStepKind>().toEqualTypeOf<
			| 'credentials'
			| 'container-pick'
			| 'status-mapping'
			| 'label-mapping'
			| 'webhook-url-display'
			| 'project-scope'
		>();
	});

	it('WizardSpec.steps is an array of standard or custom steps', () => {
		const spec: WizardSpec = {
			steps: [
				{ kind: 'credentials', id: 'creds' },
				{ kind: 'container-pick', id: 'pick' },
				{ kind: 'status-mapping', id: 'status' },
				{ kind: 'label-mapping', id: 'labels' },
				{ kind: 'webhook-url-display', id: 'wh' },
				{ kind: 'custom', id: 'my-bespoke', component: 'MyBespokeStep' },
			],
		};
		expect(spec.steps.length).toBe(6);
		// Each step has a kind + id.
		for (const step of spec.steps) {
			expect(typeof step.kind).toBe('string');
			expect(typeof step.id).toBe('string');
		}
	});
});

describe('createCustomField? hook (plan 010/1 task 1)', () => {
	it('is optional — manifests without it still satisfy PMProviderManifest', () => {
		const m: PMProviderManifest = testPMProvider;
		expect(m.createCustomField).toBeUndefined();
	});

	it('when declared, accepts { credentials, containerId, name } and returns { id, name, type }', async () => {
		const m: PMProviderManifest = {
			...testPMProvider,
			createCustomField: async ({ containerId, name }) => ({
				id: `cf-${containerId}-${name}`,
				name,
				type: 'text',
			}),
		};
		expect(typeof m.createCustomField).toBe('function');
		const hook = m.createCustomField;
		if (!hook) throw new Error('createCustomField should be defined');
		const result = await hook({
			credentials: {},
			containerId: 'board-1',
			name: 'Cost',
		});
		expect(result).toEqual({ id: 'cf-board-1-Cost', name: 'Cost', type: 'text' });
	});
});

describe('validateManifestAgainstSchema', () => {
	it('exists and returns void on a clean manifest', async () => {
		const mod = await import('../../../src/integrations/pm/manifest.js');
		expect(typeof mod.validateManifestAgainstSchema).toBe('function');
		// Should not throw on a manifest with no declared configSchema.
		expect(() => mod.validateManifestAgainstSchema(testPMProvider)).not.toThrow();
	});

	it('throws when configSchema is declared but parse fails on a fixture', async () => {
		const schema = z.object({ apiKey: z.string() });
		const m: PMProviderManifest = {
			...testPMProvider,
			configSchema: schema,
			// fixture intentionally missing apiKey
			configFixture: {} as never,
		};
		const { validateManifestAgainstSchema } = await import(
			'../../../src/integrations/pm/manifest.js'
		);
		expect(() => validateManifestAgainstSchema(m)).toThrow();
	});
});
