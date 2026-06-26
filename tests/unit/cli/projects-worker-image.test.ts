import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 022 plan 3/4 — `cascade projects` worker-image CLI surface.
 */

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
		cyan: (s: string) => s,
	},
}));

import ProjectsShow from '../../../src/cli/dashboard/projects/show.js';
import ProjectsUpdate from '../../../src/cli/dashboard/projects/update.js';

const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

/** Mirrors the helper in tests/unit/cli/dashboard/errors.test.ts. */
function makeTRPCError(code: string, message: string): TRPCClientError<never> {
	const err = new TRPCClientError(message);
	Object.assign(err, { data: { code } });
	return err;
}

function makeClient(getByIdResult: Record<string, unknown> = {}) {
	return {
		projects: {
			getById: { query: vi.fn().mockResolvedValue(getByIdResult) },
			update: { mutate: vi.fn().mockResolvedValue(undefined) },
		},
		agentConfigs: {
			enginesInUse: { query: vi.fn().mockResolvedValue([]) },
		},
	};
}

describe('projects update — worker image flags', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --worker-image <ref> to the update mutation', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--worker-image', 'ghcr.io/acme/cascade-worker:latest'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				workerImage: 'ghcr.io/acme/cascade-worker:latest',
			}),
		);
	});

	it('sends workerImage: null for --clear-worker-image', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--clear-worker-image'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'my-project', workerImage: null }),
		);
	});

	it('omits workerImage when neither flag is provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--model', 'm'], oclifConfig as never);
		await cmd.run();

		const callArg = (client.projects.update.mutate as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArg).not.toHaveProperty('workerImage');
	});

	it('surfaces a FORBIDDEN response cleanly (friendly message, not a raw stack)', async () => {
		const client = makeClient();
		(client.projects.update.mutate as ReturnType<typeof vi.fn>).mockRejectedValue(
			makeTRPCError('FORBIDDEN', 'Superadmin access required to change the worker image'),
		);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--worker-image', 'cascade-worker:local'],
			oclifConfig as never,
		);

		await expect(cmd.run()).rejects.toThrow(/denied/i);
	});
});

describe('projects show — worker image rendering', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	function capturedOutput(): string {
		return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
	}

	it('renders a pending worker image', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerImage: 'ghcr.io/acme/cascade-worker:latest',
			workerImageStatus: 'pending',
			workerImageDigest: null,
			workerImageError: null,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('pending');
		expect(capturedOutput()).toContain('ghcr.io/acme/cascade-worker:latest');
	});

	it('renders a verified worker image with its pinned digest', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerImage: 'ghcr.io/acme/cascade-worker:latest',
			workerImageStatus: 'verified',
			workerImageDigest: 'ghcr.io/acme/cascade-worker@sha256:abc',
			workerImageError: null,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('verified');
		expect(capturedOutput()).toContain('sha256:abc');
	});

	it('renders a failed worker image with the precise reason', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerImage: 'ghcr.io/acme/cascade-worker:latest',
			workerImageStatus: 'failed',
			workerImageDigest: null,
			workerImageError: 'cascade-tools not found',
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('failed');
		expect(capturedOutput()).toContain('cascade-tools not found');
	});

	it('renders the global default when no worker image is set', async () => {
		const client = makeClient({ id: 'p1', name: 'P1', workerImage: null });
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('global default');
	});
});
