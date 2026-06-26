import { describe, expect, it } from 'vitest';

import { type MapProjectInput, mapProjectRow } from '../../../src/db/repositories/configMapper.js';

/**
 * Spec 022 plan 1/4 — per-project worker image.
 *
 * Pins the configMapper NULL→undefined contract for the four worker-image
 * columns, mirroring snapshotEnabled / maxInFlightItems. Populated columns must
 * pass straight through to the raw config object consumed by validateConfig.
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
	workerImage: null,
	workerImageDigest: null,
	workerImageStatus: null,
	workerImageError: null,
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

describe('mapProjectRow — worker-image fields', () => {
	it('maps NULL columns to undefined', () => {
		const result = mapProjectRow(makeInput());
		expect(result.workerImage).toBeUndefined();
		expect(result.workerImageDigest).toBeUndefined();
		expect(result.workerImageStatus).toBeUndefined();
		expect(result.workerImageError).toBeUndefined();
	});

	it('passes through populated columns', () => {
		const result = mapProjectRow(
			makeInput({
				workerImage: 'ghcr.io/acme/cascade-worker:latest',
				workerImageDigest: 'ghcr.io/acme/cascade-worker@sha256:abcdef',
				workerImageStatus: 'verified',
				workerImageError: 'previous pull failed',
			}),
		);
		expect(result.workerImage).toBe('ghcr.io/acme/cascade-worker:latest');
		expect(result.workerImageDigest).toBe('ghcr.io/acme/cascade-worker@sha256:abcdef');
		expect(result.workerImageStatus).toBe('verified');
		expect(result.workerImageError).toBe('previous pull failed');
	});
});
