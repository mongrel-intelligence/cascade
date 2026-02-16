import { describe, expect, it, vi } from 'vitest';

// Mock all dependencies the routers pull in
vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	projects: {},
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	listRuns: vi.fn(),
	getRunById: vi.fn(),
	getRunLogs: vi.fn(),
	listLlmCallsMeta: vi.fn(),
	getLlmCallByNumber: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
	listProjectsForOrg: vi.fn(),
}));

import { appRouter } from '../../../src/api/router.js';

describe('appRouter', () => {
	it('has auth sub-router with me procedure', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('auth.me');
	});

	it('has runs sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('runs.list');
		expect(procedures).toContain('runs.getById');
		expect(procedures).toContain('runs.getLogs');
		expect(procedures).toContain('runs.listLlmCalls');
		expect(procedures).toContain('runs.getLlmCall');
		expect(procedures).toContain('runs.getDebugAnalysis');
	});

	it('has projects sub-router with list procedure', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('projects.list');
	});
});
