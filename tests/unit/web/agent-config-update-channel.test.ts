/**
 * Regression guard for the per-agent Update-channel selector (MNG-1686).
 *
 * `DefinitionAgentSection` is a hook-heavy JSX component (uses `useState`,
 * `useEffect`, and Radix `Select`). It cannot be rendered as a plain function
 * outside a React rendering context, and the unit environment has no jsdom.
 * This test reads the source directly — the same source-read pattern used by
 * `scm-webhook-secret-field.test.ts`, `combobox.test.ts`, and
 * `pm-wizard-styling-guard.test.ts`.
 *
 * The backend (MNG-1683) already accepts `updateChannel` on the agentConfigs
 * `create` / `update` tRPC mutations. This story is the UI-only selector that
 * mirrors the existing `maxConcurrency` field wiring; these assertions pin that
 * field's state / config-sync / save plumbing.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const PROJECTS_DIR = resolve(REPO_ROOT, 'web/src/components/projects');
const typesSource = readFileSync(resolve(PROJECTS_DIR, 'agent-config-types.ts'), 'utf8');
const detailSource = readFileSync(resolve(PROJECTS_DIR, 'agent-config-detail.tsx'), 'utf8');
const configsSource = readFileSync(resolve(PROJECTS_DIR, 'project-agent-configs.tsx'), 'utf8');

describe('agent-config-types — updateChannel type fields', () => {
	it('AgentConfig gains updateChannel: UpdateChannel | null', () => {
		expect(typesSource).toContain('updateChannel: UpdateChannel | null;');
	});

	it('SaveConfigValues gains updateChannel: string', () => {
		expect(typesSource).toContain('updateChannel: string;');
	});

	it('imports the UpdateChannel type from the shared config catalog (single source of truth)', () => {
		expect(typesSource).toMatch(
			/import type \{ UpdateChannel \} from '[^']*src\/config\/updateChannel\.js';/,
		);
	});
});

describe('agent-config-detail — Update channel Select wiring', () => {
	it('declares local updateChannel state defaulting to "both"', () => {
		expect(detailSource).toContain(
			"const [updateChannel, setUpdateChannel] = useState<string>(config?.updateChannel ?? 'both');",
		);
	});

	it('syncs updateChannel from config in the config-change effect (mirrors maxConcurrency)', () => {
		expect(detailSource).toContain("setUpdateChannel(config?.updateChannel ?? 'both');");
	});

	it('includes updateChannel in the save payload handed to onSaveConfig', () => {
		const handleSaveStart = detailSource.indexOf('onSaveConfig(agentType, config?.id ?? null, {');
		expect(handleSaveStart, 'handleSave call must exist').toBeGreaterThan(-1);
		const handleSaveBlock = detailSource.slice(handleSaveStart, handleSaveStart + 400);
		expect(handleSaveBlock).toContain('updateChannel,');
	});

	it('renders a Select bound to updateChannel state', () => {
		expect(detailSource).toContain(
			'<Select value={updateChannel} onValueChange={setUpdateChannel}>',
		);
	});

	it('offers Both / SCM only / PM only / None options with channel-catalog values', () => {
		expect(detailSource).toContain('<SelectItem value="both">Both</SelectItem>');
		expect(detailSource).toContain('<SelectItem value="scm-only">SCM only</SelectItem>');
		expect(detailSource).toContain('<SelectItem value="pm-only">PM only</SelectItem>');
		expect(detailSource).toContain('<SelectItem value="none">None</SelectItem>');
	});
});

describe('project-agent-configs — save handler + mutation wiring', () => {
	it('maps values.updateChannel into the shared save payload', () => {
		expect(configsSource).toContain(
			'updateChannel: values.updateChannel ? (values.updateChannel as UpdateChannel) : null,',
		);
	});

	it('forwards updateChannel into the create mutation input', () => {
		const createIdx = configsSource.indexOf('trpcClient.agentConfigs.create.mutate({');
		expect(createIdx, 'create.mutate call must exist').toBeGreaterThan(-1);
		const createBlock = configsSource.slice(createIdx, createIdx + 400);
		expect(createBlock).toContain('updateChannel: input.updateChannel,');
	});

	it('forwards updateChannel into the update mutation input', () => {
		const updateIdx = configsSource.indexOf('trpcClient.agentConfigs.update.mutate({');
		expect(updateIdx, 'update.mutate call must exist').toBeGreaterThan(-1);
		const updateBlock = configsSource.slice(updateIdx, updateIdx + 400);
		expect(updateBlock).toContain('updateChannel: input.updateChannel,');
	});
});
