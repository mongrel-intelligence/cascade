/**
 * Regression guard for the per-agent Review-event-policy selector.
 *
 * `DefinitionAgentSection` is a hook-heavy JSX component (uses `useState`,
 * `useEffect`, and Radix `Select`). It cannot be rendered as a plain function
 * outside a React rendering context, and the unit environment has no jsdom.
 * This test reads the source directly — the same source-read pattern used by
 * `agent-config-update-channel.test.ts` and `pm-wizard-styling-guard.test.ts`.
 *
 * The policy only affects `CreatePRReview`, which only the review agent has,
 * so the selector renders exclusively for `agentType === 'review'` — pinned
 * below so the field never silently leaks onto unrelated agents.
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

describe('agent-config-types — reviewEventPolicy type fields', () => {
	it('AgentConfig gains reviewEventPolicy: ReviewEventPolicy | null', () => {
		expect(typesSource).toContain('reviewEventPolicy: ReviewEventPolicy | null;');
	});

	it('SaveConfigValues gains reviewEventPolicy: string', () => {
		expect(typesSource).toContain('reviewEventPolicy: string;');
	});

	it('imports the ReviewEventPolicy type from the shared config catalog (single source of truth)', () => {
		expect(typesSource).toMatch(
			/import type \{ ReviewEventPolicy \} from '[^']*src\/config\/reviewEventPolicy\.js';/,
		);
	});
});

describe('agent-config-detail — Review event policy Select wiring', () => {
	it('declares local reviewEventPolicy state defaulting to "all"', () => {
		expect(detailSource).toMatch(
			/const \[reviewEventPolicy, setReviewEventPolicy\] = useState<string>\(\s*config\?\.reviewEventPolicy \?\? 'all',?\s*\);/,
		);
	});

	it('syncs reviewEventPolicy from config in the config-change effect (mirrors updateChannel)', () => {
		expect(detailSource).toContain("setReviewEventPolicy(config?.reviewEventPolicy ?? 'all');");
	});

	it('includes reviewEventPolicy in the save payload handed to onSaveConfig', () => {
		const handleSaveStart = detailSource.indexOf('onSaveConfig(agentType, config?.id ?? null, {');
		expect(handleSaveStart, 'handleSave call must exist').toBeGreaterThan(-1);
		const handleSaveBlock = detailSource.slice(handleSaveStart, handleSaveStart + 400);
		expect(handleSaveBlock).toContain('reviewEventPolicy,');
	});

	it('renders the selector only for the review agent type', () => {
		expect(detailSource).toContain("{agentType === 'review' && (");
	});

	it('renders a Select bound to reviewEventPolicy state', () => {
		expect(detailSource).toContain(
			'<Select value={reviewEventPolicy} onValueChange={setReviewEventPolicy}>',
		);
	});

	it('offers All events / Comment only options with policy-catalog values', () => {
		expect(detailSource).toContain('<SelectItem value="all">All events</SelectItem>');
		expect(detailSource).toContain(
			'<SelectItem value="comment-only">Comment only (advisory)</SelectItem>',
		);
	});
});

describe('project-agent-configs — save handler + mutation wiring', () => {
	it("maps values.reviewEventPolicy into the shared save payload, persisting NULL for the default 'all'", () => {
		expect(configsSource).toContain(
			"reviewEventPolicy:\n\t\t\t\tvalues.reviewEventPolicy && values.reviewEventPolicy !== 'all'\n\t\t\t\t\t? (values.reviewEventPolicy as ReviewEventPolicy)\n\t\t\t\t\t: null,",
		);
	});

	it('forwards reviewEventPolicy into the create mutation input', () => {
		const createIdx = configsSource.indexOf('trpcClient.agentConfigs.create.mutate({');
		expect(createIdx, 'create.mutate call must exist').toBeGreaterThan(-1);
		const createBlock = configsSource.slice(createIdx, createIdx + 500);
		expect(createBlock).toContain('reviewEventPolicy: input.reviewEventPolicy,');
	});

	it('forwards reviewEventPolicy into the update mutation input', () => {
		const updateIdx = configsSource.indexOf('trpcClient.agentConfigs.update.mutate({');
		expect(updateIdx, 'update.mutate call must exist').toBeGreaterThan(-1);
		const updateBlock = configsSource.slice(updateIdx, updateIdx + 500);
		expect(updateBlock).toContain('reviewEventPolicy: input.reviewEventPolicy,');
	});
});
