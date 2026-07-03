import { describe, expect, it } from 'vitest';

import { type MapProjectInput, mapProjectRow } from '../../../src/db/repositories/configMapper.js';

/**
 * Spec 023 plan 1/5 — per-project worker Dockerfile (dormant).
 *
 * Pins the configMapper contract for the new plumbing:
 *   - NULL → undefined for workerDockerfile / workerImageBuildHash /
 *     workerImageBuildStatus (mirroring the worker-image columns).
 *   - Derived workerImageSource with precedence dockerfile > reference > default,
 *     including the both-set tiebreak that resolves to `dockerfile`.
 */

const baseProjectRow = {
	id: 'proj1',
	orgId: 'org1',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	model: null,
	maxIterations: null,
	watchdogTimeoutMs: null,
	workItemBudgetUsd: null,
	progressModel: null,
	progressIntervalMinutes: null,
	agentEngine: null,
	agentEngineSettings: null,
	runLinksEnabled: false,
	maxInFlightItems: null,
	snapshotEnabled: null,
	snapshotTtlMs: null,
	setupTimeoutMs: null,
	workerImage: null,
	workerImageDigest: null,
	workerImageStatus: null,
	workerImageError: null,
	workerDockerfile: null,
	workerImageBuildHash: null,
	workerImageBuildStatus: null,
};

function makeInput(rowOverrides: Partial<typeof baseProjectRow> = {}): MapProjectInput {
	return {
		row: { ...baseProjectRow, ...rowOverrides },
		projectAgentConfigs: [],
		trelloConfig: {
			boardId: 'board123',
			lists: { todo: 'list-todo' },
			labels: {},
		},
	};
}

describe('mapProjectRow — worker-dockerfile fields', () => {
	it('maps NULL columns to undefined', () => {
		const result = mapProjectRow(makeInput());
		expect(result.workerDockerfile).toBeUndefined();
		expect(result.workerImageBuildHash).toBeUndefined();
		expect(result.workerImageBuildStatus).toBeUndefined();
	});

	it('passes through populated columns', () => {
		const result = mapProjectRow(
			makeInput({
				workerDockerfile: 'RUN apt-get install -y jq',
				workerImageBuildHash: 'abc123',
				workerImageBuildStatus: 'building',
			}),
		);
		expect(result.workerDockerfile).toBe('RUN apt-get install -y jq');
		expect(result.workerImageBuildHash).toBe('abc123');
		expect(result.workerImageBuildStatus).toBe('building');
	});
});

describe('mapProjectRow — derived workerImageSource', () => {
	it('derives `dockerfile` when worker_dockerfile is set', () => {
		const result = mapProjectRow(makeInput({ workerDockerfile: 'RUN true' }));
		expect(result.workerImageSource).toBe('dockerfile');
	});

	it('derives `reference` when only worker_image is set', () => {
		const result = mapProjectRow(makeInput({ workerImage: 'ghcr.io/acme/cascade-worker:latest' }));
		expect(result.workerImageSource).toBe('reference');
	});

	it('derives `default` when neither source column is set', () => {
		const result = mapProjectRow(makeInput());
		expect(result.workerImageSource).toBe('default');
	});

	it('resolves the both-set tiebreak to `dockerfile` (precedence over reference)', () => {
		const result = mapProjectRow(
			makeInput({
				workerDockerfile: 'RUN true',
				workerImage: 'ghcr.io/acme/cascade-worker:latest',
			}),
		);
		expect(result.workerImageSource).toBe('dockerfile');
	});

	it('treats an empty-string dockerfile as set (non-null wins)', () => {
		// The derivation is presence-based (`!= null`), so a stored empty string
		// still resolves to `dockerfile`. Guards against a `.trim()`-style regression.
		const result = mapProjectRow(makeInput({ workerDockerfile: '' }));
		expect(result.workerImageSource).toBe('dockerfile');
	});
});
