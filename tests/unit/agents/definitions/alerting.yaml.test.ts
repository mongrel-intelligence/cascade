import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY } from '../../../../src/agents/capabilities/registry.js';
import { loadBuiltinDefinition } from '../../../../src/agents/definitions/loader.js';

/**
 * Static capability invariants for the alerting agent (spec 018, plan 1).
 *
 * The "investigator-and-filer, not fixer" property from spec AC #3 is enforced
 * statically by the YAML's capability declaration: no `fs:write`, no `scm:*`
 * write capabilities. These constrain the agent's gadget allowlist at the
 * registry level — the agent literally cannot invoke `WriteFile`, `CreatePR`,
 * etc. regardless of what the prompt says. These tests pin those invariants
 * against future drift.
 */
describe('alerting agent capability invariants', () => {
	async function loadAlertingDefinition() {
		const def = await loadBuiltinDefinition('alerting');
		expect(def).not.toBeNull();
		if (!def) throw new Error('alerting definition not found');
		return def;
	}

	it('has fs:read but not fs:write in required or optional capabilities', async () => {
		const def = await loadAlertingDefinition();
		const required = def.capabilities?.required ?? [];
		const optional = def.capabilities?.optional ?? [];
		const all = [...required, ...optional];
		expect(all).toContain('fs:read');
		expect(all).not.toContain('fs:write');
	});

	it('declares no scm:* capabilities (no PR creation, no commit, no review)', async () => {
		const def = await loadAlertingDefinition();
		const required = def.capabilities?.required ?? [];
		const optional = def.capabilities?.optional ?? [];
		const all = [...required, ...optional];
		const scmCaps = all.filter((c) => c.startsWith('scm:'));
		expect(scmCaps).toEqual([]);
	});

	it('resolved gadget allowlist excludes source-edit and SCM-write gadgets', async () => {
		const def = await loadAlertingDefinition();
		const required = def.capabilities?.required ?? [];
		const optional = def.capabilities?.optional ?? [];
		const allCaps = [...required, ...optional];

		const resolvedGadgets = new Set<string>();
		for (const cap of allCaps) {
			const entry = CAPABILITY_REGISTRY[cap];
			for (const gadget of entry?.gadgetNames ?? []) {
				resolvedGadgets.add(gadget);
			}
		}

		// Source-edit / SCM-write gadgets that must NOT be reachable from the
		// alerting agent's capability set. List sourced from the SCM and
		// fs-write capability entries in CAPABILITY_REGISTRY.
		const banned = ['CreatePR', 'CreatePRReview', 'WriteFile'];
		for (const gadget of banned) {
			expect(resolvedGadgets.has(gadget)).toBe(false);
		}
	});

	it('declares the alerting:read capability so investigation tools are reachable', async () => {
		const def = await loadAlertingDefinition();
		const required = def.capabilities?.required ?? [];
		expect(required).toContain('alerting:read');
	});
});
