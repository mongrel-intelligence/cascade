import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Conformance: every YAML-registered agent type must have a corresponding
 * `.eta` prompt template at `src/agents/prompts/templates/<type>.eta`.
 *
 * This test is the regression net for the 2026-05-06 prod incident where the
 * alerting agent was registered (alerting.yaml present) without its prompt
 * template (alerting.eta missing). The worker reached agent boot, hit ENOENT,
 * and silently exited 0 with no run record visible in the dashboard. Spec 018
 * AC #13.
 *
 * Future agent additions that ship a YAML definition without writing the
 * matching prompt template will fail CI here with a precise file path naming
 * the missing template.
 */
describe('agent prompt template conformance', () => {
	const definitionsDir = join(__dirname, '../../../../src/agents/definitions');
	const templatesDir = join(__dirname, '../../../../src/agents/prompts/templates');

	const agentTypes = readdirSync(definitionsDir)
		.filter((file) => file.endsWith('.yaml'))
		.map((file) => file.replace(/\.yaml$/, ''));

	it('every YAML-registered agent type has a matching .eta template', () => {
		const missing: string[] = [];
		for (const agentType of agentTypes) {
			const templatePath = join(templatesDir, `${agentType}.eta`);
			if (!existsSync(templatePath)) {
				missing.push(`${agentType} -> expected at ${templatePath}`);
			}
		}
		expect(
			missing,
			`Agent types are registered (YAML present) but their prompt templates are missing. ` +
				`This produces a worker boot-time ENOENT for any dispatch of these agents. ` +
				`Either add the .eta template or remove the YAML.\nMissing:\n  ${missing.join('\n  ')}`,
		).toEqual([]);
	});

	it('discovers a non-empty set of agent types (sanity check)', () => {
		// If this fails, our directory glob is broken — the test above would be
		// silently green-with-no-coverage.
		expect(agentTypes.length).toBeGreaterThan(0);
	});
});
