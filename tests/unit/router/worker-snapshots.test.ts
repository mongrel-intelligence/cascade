import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockCaptureException,
	mockContainerCommit,
	mockContainerRemove,
	mockDockerGetContainer,
	mockDockerGetImage,
	mockImageInspect,
	mockLoggerWarn,
	mockRegisterSnapshot,
} = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
	mockContainerCommit: vi.fn(),
	mockContainerRemove: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockDockerGetImage: vi.fn(),
	mockImageInspect: vi.fn(),
	mockLoggerWarn: vi.fn(),
	mockRegisterSnapshot: vi.fn(),
}));

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getContainer: mockDockerGetContainer,
		getImage: mockDockerGetImage,
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	registerSnapshot: (...args: unknown[]) => mockRegisterSnapshot(...args),
}));

import {
	buildWorkerSnapshotImageName,
	commitWorkerSnapshot,
	isImageNotFoundError,
	removeWorkerContainerBestEffort,
} from '../../../src/router/worker-snapshots.js';

describe('worker-snapshots', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContainerCommit.mockResolvedValue(undefined);
		mockContainerRemove.mockResolvedValue(undefined);
		mockImageInspect.mockResolvedValue({ Size: 1_234_567_890 });
		mockDockerGetContainer.mockReturnValue({
			commit: mockContainerCommit,
			remove: mockContainerRemove,
		});
		mockDockerGetImage.mockReturnValue({
			inspect: mockImageInspect,
		});
	});

	it('preserves the existing snapshot image-name sanitization format', () => {
		expect(buildWorkerSnapshotImageName('Proj Snap', 'MNG_652/Worker Snapshot!')).toBe(
			'cascade-snapshot-proj-snap-mng-652-worker-snapshot:latest',
		);
		expect(buildWorkerSnapshotImageName('--LLMIST--', 'MNG---95')).toBe(
			'cascade-snapshot-llmist-mng-95:latest',
		);
	});

	it('commits the worker container, inspects image size, and registers metadata', async () => {
		await commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap');

		expect(mockDockerGetContainer).toHaveBeenCalledWith('container-snap-abc123');
		expect(mockContainerCommit).toHaveBeenCalledWith({
			repo: 'cascade-snapshot-proj-snap-card-snap',
			tag: 'latest',
		});
		expect(mockDockerGetImage).toHaveBeenCalledWith('cascade-snapshot-proj-snap-card-snap:latest');
		expect(mockRegisterSnapshot).toHaveBeenCalledWith(
			'proj-snap',
			'card-snap',
			'cascade-snapshot-proj-snap-card-snap:latest',
			1_234_567_890,
		);
	});

	it('still registers snapshot metadata when image-size inspection fails', async () => {
		mockImageInspect.mockRejectedValueOnce(new Error('inspect failed'));

		await commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap');

		expect(mockRegisterSnapshot).toHaveBeenCalledWith(
			'proj-snap',
			'card-snap',
			'cascade-snapshot-proj-snap-card-snap:latest',
			undefined,
		);
	});

	it('swallows commit errors and reports them as non-fatal snapshot failures', async () => {
		const err = new Error('commit failed');
		mockContainerCommit.mockRejectedValueOnce(err);

		await expect(
			commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap'),
		).resolves.toBeUndefined();

		expect(mockRegisterSnapshot).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			'[WorkerManager] Failed to commit container to snapshot (non-fatal):',
			expect.objectContaining({
				containerId: 'container-sn',
				imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
				error: 'Error: commit failed',
			}),
		);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: { source: 'snapshot_commit' },
				level: 'warning',
			}),
		);
	});

	it('removes worker containers best-effort', async () => {
		await removeWorkerContainerBestEffort('container-snap-abc123');

		expect(mockDockerGetContainer).toHaveBeenCalledWith('container-snap-abc123');
		expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
	});

	it('swallows remove errors', async () => {
		mockContainerRemove.mockRejectedValueOnce(new Error('already gone'));

		await expect(removeWorkerContainerBestEffort('container-snap-abc123')).resolves.toBeUndefined();
	});

	it('identifies docker image-not-found errors only for 404 no-such-image responses', () => {
		expect(
			isImageNotFoundError(
				Object.assign(new Error('(HTTP code 404) no such container - No such image: x'), {
					statusCode: 404,
				}),
			),
		).toBe(true);
		expect(
			isImageNotFoundError(Object.assign(new Error('No such image: x'), { statusCode: 500 })),
		).toBe(false);
		expect(isImageNotFoundError(Object.assign(new Error('not found'), { statusCode: 404 }))).toBe(
			false,
		);
	});
});
