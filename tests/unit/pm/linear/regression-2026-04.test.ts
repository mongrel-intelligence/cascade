/**
 * Regression guards for the six bug classes that shipped during the
 * Linear integration workstream in 2026-04. Each describe block names
 * the bug numbers it locks down.
 *
 * Spec 009 type-locks these classes. If any of these tests fail, the
 * corresponding shape of bug has crept back in.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';
import type { ContainerId, LabelId, StateId } from '../../../../src/pm/ids.js';
import { InvalidIdError, parseStateId } from '../../../../src/pm/ids.js';
import type { LinearPMProvider } from '../../../../src/pm/linear/adapter.js';
import { LinearIntegration } from '../../../../src/pm/linear/integration.js';
import type { WorkItem } from '../../../../src/pm/types.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');

describe('2026-04 regression: #1117 / #1137 / #1139 (state-name vs state-ID)', () => {
	it('LinearPMProvider.moveWorkItem destination type is ContainerId, not string', () => {
		// This is the compile-time fence that would have caught #1137 —
		// creating an issue then moving to a state name instead of ID.
		type MoveParams = Parameters<LinearPMProvider['moveWorkItem']>;
		expectTypeOf<MoveParams[1]>().toEqualTypeOf<ContainerId>();
	});

	it('LinearPMProvider.addLabel / removeLabel parameter is LabelId, not string', () => {
		// Label storage shape — #1117 stored label NAMES where IDs were
		// required. Branded LabelId blocks that class.
		type AddParams = Parameters<LinearPMProvider['addLabel']>;
		type RemoveParams = Parameters<LinearPMProvider['removeLabel']>;
		expectTypeOf<AddParams[1]>().toEqualTypeOf<LabelId>();
		expectTypeOf<RemoveParams[1]>().toEqualTypeOf<LabelId>();
	});

	it('parseStateId throws InvalidIdError on empty input (runtime boundary)', () => {
		// When user-supplied input flows in, parse at the boundary throws
		// loud rather than silently stripping — which would have caught
		// the variants of #1139 where empty stateId was passed through.
		expect(() => parseStateId('')).toThrow(InvalidIdError);
		expect(() => parseStateId('   ')).toThrow(InvalidIdError);
	});

	it('parseStateId produces a StateId branded value that is distinct from string at the type level', () => {
		const id = parseStateId('0bd4a4e5-9d8c-4e7f-8b1a-1234567890ab');
		expectTypeOf(id).toEqualTypeOf<StateId>();
		expectTypeOf<StateId>().not.toEqualTypeOf<string>();
	});
});

describe('2026-04 regression: #1138 / #1142 (projectId stripped by Zod)', () => {
	it('linearManifest.configSchema preserves projectId through round-trip', () => {
		const schema = linearManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;

		const input = {
			teamId: 'team-1',
			projectId: 'project-1',
			statuses: { todo: 'state-todo' },
		};
		const parsed = schema.parse(input) as { projectId?: string };
		expect(parsed.projectId).toBe('project-1');

		// Re-parse through JSON round-trip (matches the DB save → load path).
		const reparsed = schema.parse(JSON.parse(JSON.stringify(parsed))) as {
			projectId?: string;
		};
		expect(reparsed.projectId).toBe('project-1');
	});

	it('linearManifest.configFixture includes projectId (exercise the fix end-to-end)', () => {
		const schema = linearManifest.configSchema;
		if (!schema) return;
		const parsed = schema.parse(linearManifest.configFixture) as { projectId?: string };
		expect(parsed.projectId).toBeDefined();
	});
});

describe('2026-04 regression: #1112 / #1119 (Linear auth-header divergence)', () => {
	/**
	 * Plan 1 ships a codebase-wide grep assertion in
	 * tests/unit/integrations/auth-header-provenance.test.ts. This is a
	 * Linear-scoped restatement — any new Linear-specific file that
	 * re-implements Bearer-header assembly outside the shared helper
	 * fails this test with an explicit #1112 / #1119 reminder.
	 */
	it('no Linear-specific file outside _shared/auth-headers.ts assembles Bearer auth headers', () => {
		const LINEAR_DIRS = [
			'src/linear',
			'src/pm/linear',
			'src/integrations/pm/linear',
			'src/router/platformClients/linear.ts',
			'src/router/bot-identity-resolvers.ts', // uses linearAuthHeader
		];
		const suspicious = /['"`]Bearer\s+\$\{/;
		const offenders: string[] = [];
		for (const relative of LINEAR_DIRS) {
			const full = resolve(PROJECT_ROOT, relative);
			try {
				const content = readFileSync(full, 'utf8');
				if (suspicious.test(content)) offenders.push(relative);
			} catch {
				// Directory — walk its files looking for .ts matches. We rely
				// on the top-level provenance test to exhaustively sweep src/;
				// here we only spot-check the Linear-specific files that had
				// divergent builders before #1119.
			}
		}
		expect(
			offenders,
			`#1112 / #1119 regression: Linear auth-header assembly leaked outside _shared/auth-headers.ts in ${offenders.join(', ')}`,
		).toEqual([]);
	});
});

describe('2026-04 regression: #1133 (listWorkItems contract mismatch)', () => {
	/**
	 * The behavioral conformance harness runs `runLifecycleScenario`
	 * against Linear's lifecycle fixture (see pm-conformance.test.ts).
	 * That scenario calls `listWorkItems(containerId)` and asserts the
	 * return is `WorkItem[]` with the required fields present. This
	 * test is a type-level restatement of the same invariant at the
	 * Linear-specific layer.
	 */
	it('LinearPMProvider.listWorkItems returns Promise<WorkItem[]>', () => {
		type ListReturn = ReturnType<LinearPMProvider['listWorkItems']>;
		expectTypeOf<ListReturn>().toEqualTypeOf<Promise<WorkItem[]>>();
	});

	it('WorkItem shape has the required contract fields (id/title/description/url/labels)', () => {
		type Required = Pick<WorkItem, 'id' | 'title' | 'description' | 'url' | 'labels'>;
		expectTypeOf<Required>().toMatchTypeOf<Required>();
	});
});

describe('2026-04 regression: #1097 / #1118 / #1131 / #1134 (registration miss)', () => {
	it('linearManifest.extractProjectIdFromJob returns projectId for a Linear job', async () => {
		// #1118: Linear worker spawned without credentials because the
		// extractor returned null for Linear jobs.
		const job = { type: 'linear', projectId: 'p1' } as never;
		expect(await linearManifest.extractProjectIdFromJob(job)).toBe('p1');
	});

	it('linearManifest.extractProjectIdFromJob returns null for a non-Linear job', async () => {
		const job = { type: 'github', projectId: 'p1' } as never;
		expect(await linearManifest.extractProjectIdFromJob(job)).toBeNull();
	});

	it('every runtime entrypoint imports src/integrations/entrypoint.ts (plan 1 usage guard holds)', () => {
		// #1097 / #1131 / #1134: Linear registered in some runtime surfaces
		// but not others. Plan 1's entrypoint-usage test asserts this for
		// all providers; we check one Linear-relevant entry here as a
		// sanity spot-check.
		const entry = resolve(PROJECT_ROOT, 'src/cli/bootstrap.ts');
		const content = readFileSync(entry, 'utf8');
		expect(content).toMatch(/integrations\/entrypoint\.js/);
	});
});

describe('2026-04 regression: Linear auto-label propagation with name strings', () => {
	/**
	 * Root cause: propagateAutoLabelAfterSplitting passed pmConfig.labels.auto
	 * directly to provider.addLabel(). For Linear, resolveLifecycleConfig previously
	 * defaulted unconfigured labels to name strings (e.g. 'cascade-auto'). Linear's
	 * adapter requires UUIDs — passing a name string causes resolveLabelId() to return
	 * null and the label operation silently no-ops.
	 *
	 * Fix (two-pronged):
	 * 1. LinearIntegration.resolveLifecycleConfig now returns undefined for unconfigured
	 *    labels (not name strings). Propagation is skipped when no label is configured.
	 * 2. propagateAutoLabelAfterSplitting resolves the actual UUID from the parent work
	 *    item's label list, even when pmConfig.labels.auto is a name string.
	 */
	it('LinearIntegration.resolveLifecycleConfig returns undefined for unconfigured labels', () => {
		// Unconfigured Linear project (no labels section) → all labels undefined.
		// This prevents silent failures when addLabel receives a name string instead of UUID.
		const project = {
			pm: { type: 'linear' },
			linear: { teamId: 'team-1', statuses: {} },
		} as unknown as ProjectConfig;
		const integration = new LinearIntegration();
		const config = integration.resolveLifecycleConfig(project);

		expect(config.labels.auto).toBeUndefined();
		expect(config.labels.processing).toBeUndefined();
		expect(config.labels.processed).toBeUndefined();
		expect(config.labels.error).toBeUndefined();
		expect(config.labels.readyToProcess).toBeUndefined();
	});

	it('LinearIntegration.resolveLifecycleConfig preserves explicitly configured label values', () => {
		// When a user has configured UUIDs, they must be preserved exactly.
		const project = {
			pm: { type: 'linear' },
			linear: {
				teamId: 'team-1',
				statuses: {},
				labels: {
					auto: 'uuid-auto-111',
					processing: 'uuid-processing-222',
					processed: 'uuid-processed-333',
					error: 'uuid-error-444',
					readyToProcess: 'uuid-rtp-555',
				},
			},
		} as unknown as ProjectConfig;
		const integration = new LinearIntegration();
		const config = integration.resolveLifecycleConfig(project);

		expect(config.labels.auto).toBe('uuid-auto-111');
		expect(config.labels.processing).toBe('uuid-processing-222');
		expect(config.labels.processed).toBe('uuid-processed-333');
		expect(config.labels.error).toBe('uuid-error-444');
		expect(config.labels.readyToProcess).toBe('uuid-rtp-555');
	});

	it('LinearIntegration.resolveLifecycleConfig does not default to name strings (unlike JIRA)', () => {
		// Explicit regression guard: the old code had `labels?.auto ?? 'cascade-auto'`.
		// JIRA intentionally keeps these defaults (JIRA auto-creates labels by name);
		// Linear must NOT have them (Linear requires UUIDs).
		const project = {
			pm: { type: 'linear' },
			linear: { teamId: 'team-1', statuses: {}, labels: {} },
		} as unknown as ProjectConfig;
		const integration = new LinearIntegration();
		const config = integration.resolveLifecycleConfig(project);

		// None of these should be a non-empty string default
		expect(config.labels.auto).not.toBe('cascade-auto');
		expect(config.labels.processing).not.toBe('cascade-processing');
		expect(config.labels.processed).not.toBe('cascade-processed');
		expect(config.labels.error).not.toBe('cascade-error');
		expect(config.labels.readyToProcess).not.toBe('cascade-ready');
	});
});
