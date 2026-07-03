import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 023 plan 4 — `cascade projects` worker-Dockerfile CLI surface.
 *
 * Pins `--dockerfile-file <path>` / `-` (stdin) round-trip, exclusivity with the
 * referenced-image flags, `--clear-dockerfile`, the `--rebuild-worker-image`
 * action, and `show` rendering of the Dockerfile build lifecycle.
 */

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

const DOCKERFILE_PATH = '/tmp/worker.dockerfile';
const DOCKERFILE_FROM_FILE = 'RUN apt-get update && apt-get install -y jq';
const DOCKERFILE_FROM_STDIN = 'COPY ./tools /opt/tools';

vi.mock('../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

// Partially mock node:fs: the CLI's Dockerfile reads (a known path or stdin fd 0)
// resolve to fixed content; every other readFileSync (oclif internals) delegates
// to the real implementation.
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		readFileSync: (path: unknown, ...rest: unknown[]) => {
			if (path === 0) return DOCKERFILE_FROM_STDIN;
			if (path === DOCKERFILE_PATH) return DOCKERFILE_FROM_FILE;
			return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
		},
	};
});

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

/** Mirrors the helper in tests/unit/cli/projects-worker-image.test.ts. */
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
			rebuildWorkerImage: { mutate: vi.fn().mockResolvedValue(undefined) },
		},
		agentConfigs: {
			enginesInUse: { query: vi.fn().mockResolvedValue([]) },
		},
	};
}

describe('projects update — worker Dockerfile flags', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('reads --dockerfile-file <path> and passes the content as workerDockerfile', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--dockerfile-file', DOCKERFILE_PATH],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'my-project', workerDockerfile: DOCKERFILE_FROM_FILE }),
		);
	});

	it('reads Dockerfile content from stdin when --dockerfile-file is "-"', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--dockerfile-file', '-'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'my-project', workerDockerfile: DOCKERFILE_FROM_STDIN }),
		);
	});

	it('sends workerDockerfile: null for --clear-dockerfile', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--clear-dockerfile'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'my-project', workerDockerfile: null }),
		);
	});

	it('omits workerDockerfile when no Dockerfile flag is provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--model', 'm'], oclifConfig as never);
		await cmd.run();

		const callArg = (client.projects.update.mutate as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArg).not.toHaveProperty('workerDockerfile');
	});

	it('rejects combining --dockerfile-file with --worker-image (mutually exclusive)', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--dockerfile-file', DOCKERFILE_PATH, '--worker-image', 'some:ref'],
			oclifConfig as never,
		);

		await expect(cmd.run()).rejects.toThrow();
		expect(client.projects.update.mutate).not.toHaveBeenCalled();
	});

	it('calls rebuildWorkerImage for --rebuild-worker-image and does not call update', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--rebuild-worker-image'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.rebuildWorkerImage.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
		expect(client.projects.update.mutate).not.toHaveBeenCalled();
	});

	it('surfaces a FORBIDDEN rebuild response cleanly (friendly message, not a raw stack)', async () => {
		const client = makeClient();
		(client.projects.rebuildWorkerImage.mutate as ReturnType<typeof vi.fn>).mockRejectedValue(
			makeTRPCError('FORBIDDEN', 'Superadmin access required'),
		);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--rebuild-worker-image'], oclifConfig as never);

		await expect(cmd.run()).rejects.toThrow(/denied/i);
	});
});

describe('projects show — worker Dockerfile rendering', () => {
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

	it('renders a building Dockerfile-sourced project', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerDockerfile: 'RUN echo hi',
			workerImageStatus: 'building',
			workerImageBuildStatus: 'building',
			workerImageDigest: null,
			workerImageError: null,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('Dockerfile');
		expect(capturedOutput()).toContain('building');
	});

	it('renders a failed Dockerfile build with the precise reason', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerDockerfile: 'RUN echo hi',
			workerImageStatus: 'failed',
			workerImageBuildStatus: 'failed',
			workerImageDigest: null,
			workerImageError: 'cascade-tools not found',
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('Dockerfile');
		expect(capturedOutput()).toContain('failed');
		expect(capturedOutput()).toContain('cascade-tools not found');
	});

	it('renders a verified Dockerfile-built image with its pinned local image id', async () => {
		const client = makeClient({
			id: 'p1',
			name: 'P1',
			workerDockerfile: 'RUN echo hi',
			workerImageStatus: 'verified',
			workerImageBuildStatus: null,
			workerImageDigest: 'sha256:localbuiltimageid',
			workerImageError: null,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		await new ProjectsShow(['p1'], oclifConfig as never).run();

		expect(capturedOutput()).toContain('Dockerfile');
		expect(capturedOutput()).toContain('verified');
		expect(capturedOutput()).toContain('sha256:localbuiltimageid');
	});
});
