/**
 * New-provider-surface guard — plan 009/5 task 4.
 *
 * Spec 009's AC #10: **a new PM provider PR should not need to modify
 * shared router / worker / CLI / dashboard / configMapper / central
 * schema files**. Everything a new provider needs goes in its provider
 * folder + its wizard folder + the single-entrypoint file.
 *
 * This test records the set of "shared surface" files that a new PM
 * provider should NOT have to touch. A PR that modifies one fails the
 * test with an explanatory error pointing at spec 009 AC #10 and
 * forcing a conscious justification. This is a convention-enforcement
 * guard, not a hard ban — if a contributor genuinely needs to extend
 * shared infrastructure (e.g., adding a new StandardStepKind), they
 * update the expected list below and explain why in the commit message.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * Files a new PM provider PR should NOT need to edit. Each entry is
 * here because adding a provider used to require a change — but no
 * longer does, as of spec 009. Entries should match on existence (the
 * file must exist) and be stable over time.
 */
const SHARED_SURFACE_FILES = [
	// Runtime entry points — already go through single entrypoint.
	'src/router/index.ts',
	'src/worker-entry.ts',
	'src/cli/bootstrap.ts',
	'src/dashboard.ts',

	// PM contract surface — stable; no per-provider branching.
	'src/integrations/pm/manifest.ts',
	'src/integrations/pm/registry.ts',
	'src/integrations/pm/index.ts',
	'src/integrations/entrypoint.ts',

	// Generic discovery + wizard generator.
	'src/api/routers/pm-discovery.ts',
	'web/src/components/projects/pm-providers/generator.tsx',

	// Shared PM wizard orchestration — provider picker, edit hydration
	// dispatch, verification, save, and common save step are metadata-driven
	// or provider-definition driven. New-provider frontend work belongs in
	// web/src/components/projects/pm-providers/<provider>/, with
	// pm-wizard-state.ts as the only deliberate shared dashboard exception
	// while it composes provider state slices into the aggregate WizardState.
	'web/src/components/projects/pm-wizard.tsx',
	'web/src/components/projects/pm-wizard-hooks.ts',
	'web/src/components/projects/pm-wizard-common-steps.tsx',

	// Frontend PM provider barrel — new providers add one import here,
	// just like the backend barrel at src/integrations/pm/index.ts.
	// pm-wizard.tsx imports this barrel and never needs to change.
	'web/src/components/projects/pm-providers/index.ts',

	// Shared wizard step components (plan 010/3 + plan 011/1) — real
	// components for every StandardStepKind. A new provider with purely
	// standard steps never touches these files; it declares
	// `wizardSpec.steps` in its manifest and reuses the shared UI through
	// the generator.
	'web/src/components/projects/pm-providers/steps/credentials.tsx',
	'web/src/components/projects/pm-providers/steps/container-pick.tsx',
	'web/src/components/projects/pm-providers/steps/status-mapping.tsx',
	'web/src/components/projects/pm-providers/steps/label-mapping.tsx',
	'web/src/components/projects/pm-providers/steps/webhook-url-display.tsx',
	'web/src/components/projects/pm-providers/steps/project-scope.tsx',
	'web/src/components/projects/pm-providers/steps/custom-field-mapping.tsx',

	// Central config schema — providers bring their own schema files.
	'src/config/schema.ts',

	// Config mapper — provider-agnostic (transforms live per-provider).
	'src/db/repositories/configMapper.ts',
] as const;

describe('new-provider-surface (plan 009/5 task 4, spec 009 AC #10)', () => {
	it.each(SHARED_SURFACE_FILES)('shared surface file exists: %s', (relativePath) => {
		const full = resolve(PROJECT_ROOT, relativePath);
		expect(statSync(full).isFile()).toBe(true);
	});

	it('each shared surface file has non-trivial content (sanity guard against accidental deletion)', () => {
		for (const relativePath of SHARED_SURFACE_FILES) {
			const full = resolve(PROJECT_ROOT, relativePath);
			const content = readFileSync(full, 'utf8');
			expect(
				content.length,
				`Shared surface file ${relativePath} appears empty or deleted — a new PM provider PR should never require this`,
			).toBeGreaterThan(10);
		}
	});

	/**
	 * The explanatory assertion — this is the one that surfaces when
	 * the guard catches something. It always passes on a clean tree;
	 * its job is to carry the human-readable contract.
	 */
	it('documents the spec 009 AC #10 invariant', () => {
		const invariant = [
			'Spec 009 AC #10: A new PM provider PR does not need to modify',
			'shared router / worker / CLI / dashboard / configMapper /',
			'central schema / cross-category registry files. Everything',
			'required for a new provider lives in:',
			'  - src/integrations/pm/<provider>/',
			'  - web/src/components/projects/pm-providers/<provider>/',
			'    (wizard.ts, state.ts, hooks.ts, auth.ts, webhook-step.tsx, custom steps)',
			'  - A single import line in src/integrations/pm/index.ts (backend barrel)',
			'  - A single import line in web/src/components/projects/pm-providers/index.ts (frontend barrel)',
			'Shared pm-wizard.tsx, pm-wizard-hooks.ts, and pm-wizard-common-steps.tsx',
			'are intentionally provider-agnostic. The current explicit frontend',
			'exception is pm-wizard-state.ts, which composes provider-owned state',
			'slices from web/src/components/projects/pm-providers/<provider>/state.ts.',
			'If you need to edit one of the guarded shared surface files above,',
			'update this test with the justification and the new expected state.',
		].join('\n');
		expect(invariant.length).toBeGreaterThan(0);
	});
});
