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
 *
 * The three shared PM wizard orchestration files (pm-wizard.tsx,
 * pm-wizard-hooks.ts, pm-wizard-common-steps.tsx) receive an additional
 * SHA-256 content-hash guard (see GUARDED_WIZARD_FILE_HASHES below).
 * Unlike the existence check, the hash check fails when the file is
 * *modified*, not just when it is deleted — matching the documented
 * invariant that adding a provider should never require editing them.
 * Update a pinned hash only when the file genuinely needs to change for
 * non-provider-specific reasons, and include the justification in the
 * commit message.
 */

import { createHash } from 'node:crypto';
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

/**
 * Pinned SHA-256 content hashes for the shared PM wizard orchestration
 * files that a new provider PR must NEVER modify. The existence check in
 * SHARED_SURFACE_FILES above only catches deletion; these hashes catch any
 * modification — matching the README/architecture claim that these files
 * are "guarded shared surface".
 *
 * To update a hash (legitimate infrastructure change, not a new-provider
 * addition): run `node -e "const c=require('crypto'),f=require('fs');
 * console.log(c.createHash('sha256').update(f.readFileSync('<path>','utf8')).digest('hex'))"`,
 * paste the new value here, and include the justification in the commit message.
 */
const GUARDED_WIZARD_FILE_HASHES: Record<string, string> = {
	'web/src/components/projects/pm-wizard.tsx':
		'402cc6829689f34dfec940034f8ba014fe14425671018d0455ad67145e6a0fb9',
	'web/src/components/projects/pm-wizard-hooks.ts':
		'7eab3a6cdf2657116658d111ca238f98444ce569e7f2bc61e3acd70b71113913',
	'web/src/components/projects/pm-wizard-common-steps.tsx':
		'0d9ca8bb56036687aed695b502be75ebf2a753195decb2e6b58f440c2abaa7c9',
};

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
	 * Content-hash guard for the shared PM wizard orchestration files.
	 * Unlike the existence check above, this assertion fails the moment
	 * any of the three guarded files is modified — making the "guarded
	 * shared surface" claim in the README and architecture docs accurate.
	 *
	 * A legitimate change to one of these files (e.g., fixing a shared
	 * wizard bug, adding a StandardStepKind) must update the corresponding
	 * hash in GUARDED_WIZARD_FILE_HASHES and include a justification in
	 * the commit message explaining why this is not a new-provider edit.
	 */
	it.each(
		Object.entries(GUARDED_WIZARD_FILE_HASHES),
	)('shared wizard orchestration file is unmodified: %s', (relativePath, expectedHash) => {
		const full = resolve(PROJECT_ROOT, relativePath);
		const content = readFileSync(full, 'utf8');
		const actualHash = createHash('sha256').update(content).digest('hex');
		expect(
			actualHash,
			[
				`Shared wizard orchestration file ${relativePath} has been modified.`,
				`Expected SHA-256: ${expectedHash}`,
				`Actual   SHA-256: ${actualHash}`,
				``,
				`Spec 009 AC #10: adding a new PM provider must NOT require editing`,
				`pm-wizard.tsx, pm-wizard-hooks.ts, or pm-wizard-common-steps.tsx.`,
				`All new-provider frontend work belongs in:`,
				`  web/src/components/projects/pm-providers/<provider>/`,
				`    (wizard.ts, state.ts, hooks.ts, auth.ts, webhook-step.tsx, custom steps)`,
				``,
				`If your change is a legitimate infrastructure edit (not a new-provider`,
				`addition), update the hash in GUARDED_WIZARD_FILE_HASHES in this test`,
				`and include a justification in the commit message.`,
			].join('\n'),
		).toBe(expectedHash);
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
