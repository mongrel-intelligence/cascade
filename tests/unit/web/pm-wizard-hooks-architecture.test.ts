import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PM_WIZARD_HOOKS_PATH = resolve(REPO_ROOT, 'web/src/components/projects/pm-wizard-hooks.ts');

const PROVIDER_SPECIFIC_HOOK_EXPORTS = [
	'useTrelloDiscovery',
	'useTrelloLabelCreation',
	'useTrelloCustomFieldCreation',
	'useJiraDiscovery',
	'useJiraLabelCreation',
	'useJiraCustomFieldCreation',
	'useLinearDiscovery',
	'useLinearLabelCreation',
	'useLinearCustomFieldCreation',
] as const;

function readSharedHooks(): string {
	return readFileSync(PM_WIZARD_HOOKS_PATH, 'utf8');
}

describe('pm-wizard-hooks architecture boundary', () => {
	it('does not export provider-specific hook wrappers', () => {
		const source = readSharedHooks();

		for (const hookName of PROVIDER_SPECIFIC_HOOK_EXPORTS) {
			expect(
				source,
				`${hookName} must live under web/src/components/projects/pm-providers/<provider>/hooks.ts, not pm-wizard-hooks.ts`,
			).not.toMatch(new RegExp(`\\bexport\\s+(?:function|const)\\s+${hookName}\\b`));
			expect(source, `${hookName} must not be re-exported from pm-wizard-hooks.ts`).not.toMatch(
				new RegExp(`\\bexport\\s*\\{[^}]*\\b${hookName}\\b[^}]*\\}`),
			);
		}
	});

	it('does not import provider-owned modules', () => {
		const source = readSharedHooks();

		expect(
			source,
			'pm-wizard-hooks.ts must stay provider-agnostic; import provider-owned hook/auth modules from provider folders instead.',
		).not.toMatch(/from ['"].*\/pm-providers\/(?:trello|jira|linear)\//);
		expect(
			source,
			'pm-wizard-hooks.ts must stay provider-agnostic; do not import backend provider modules directly.',
		).not.toMatch(/from ['"].*\/src\/integrations\/pm\/(?:trello|jira|linear)\//);
	});

	it('does not contain provider-owned verification or save dispatch maps', () => {
		const source = readSharedHooks();

		expect(
			source,
			'SAVE_CONFIGS belongs in provider metadata, not pm-wizard-hooks.ts',
		).not.toContain('SAVE_CONFIGS');
		expect(
			source,
			'Verification/save auth must be metadata-driven; do not branch on state.provider in pm-wizard-hooks.ts.',
		).not.toMatch(/\bstate\.provider\s*={2,3}\s*['"](?:trello|jira|linear)['"]/);
		expect(
			source,
			'Provider-specific verified-as display formatting belongs on ProviderWizardDefinition.formatVerificationDisplay.',
		).not.toMatch(/\bexport\s+function\s+formatVerificationDisplay\b/);
	});

	it('does not hard-code provider ids in shared config type declarations', () => {
		const source = readSharedHooks();

		// LabelCreationConfig and CustomFieldCreationConfig must accept any provider id
		// so that new providers can use the shared factories without editing this file.
		expect(
			source,
			"LabelCreationConfig.providerId must be 'string', not a literal union — new providers must not need to edit pm-wizard-hooks.ts",
		).not.toMatch(/providerId:\s*'(?:trello|jira|linear)'\s*\|/);
		expect(
			source,
			"runPerLabelCreations opts.providerId must be 'string', not a literal union",
		).not.toMatch(/providerId:\s*'(?:trello|jira|linear)'\s*\|/);
	});
});
