import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyCompletionEvidence } from '../../../src/backends/completion.js';
import type { AgentEngineResult } from '../../../src/backends/types.js';

describe('applyCompletionEvidence', () => {
	it('returns result unchanged when no sidecar exists', () => {
		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
			prUrl: undefined,
			prEvidence: undefined,
		};
		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath: '/nonexistent/path.json',
		});
		expect(updated).toBe(result);
	});

	it('returns result unchanged when no completionRequirements', () => {
		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
		};
		const updated = applyCompletionEvidence(result, undefined);
		expect(updated).toBe(result);
	});

	it('upgrades text evidence to authoritative when sidecar exists', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(
			prSidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/owner/repo/pull/42',
				source: 'cascade-tools scm create-pr',
			}),
		);

		const result: AgentEngineResult = {
			success: true,
			output: 'PR created at https://github.com/owner/repo/pull/42',
			cost: 0.1,
			prUrl: 'https://github.com/owner/repo/pull/42',
			prEvidence: { source: 'text', authoritative: false },
		};

		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath,
		});

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/42');
		expect(updated.prEvidence).toEqual({
			source: 'native-tool-sidecar',
			authoritative: true,
			command: 'cascade-tools scm create-pr',
		});
		// Should preserve other fields
		expect(updated.success).toBe(true);
		expect(updated.output).toBe('PR created at https://github.com/owner/repo/pull/42');
		expect(updated.cost).toBe(0.1);
	});

	it('adds PR evidence when result had no prUrl', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(
			prSidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/owner/repo/pull/99',
				source: 'cascade-tools scm create-pr',
			}),
		);

		const result: AgentEngineResult = {
			success: true,
			output: 'Done',
			cost: 0.1,
		};

		const updated = applyCompletionEvidence(result, {
			requiresPR: true,
			prSidecarPath,
		});

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/99');
		expect(updated.prEvidence?.authoritative).toBe(true);
	});

	it('uses default command when source is missing from sidecar', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-completion-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(prSidecarPath, JSON.stringify({ prUrl: 'https://github.com/o/r/pull/1' }));

		const result: AgentEngineResult = { success: true, output: '', cost: 0 };
		const updated = applyCompletionEvidence(result, { prSidecarPath });

		rmSync(tempDir, { recursive: true, force: true });

		expect(updated.prEvidence?.command).toBe('cascade-tools scm create-pr');
	});
});
