// @vitest-environment jsdom
/**
 * Tests for the dashboard Worker Image control (spec 022 plan 4/4, MNG-1699).
 *
 * `ProjectWorkerImage` is a hook-heavy component (useQuery/useMutation/useState),
 * so it cannot be called as a plain function or SSR-rendered like the pure step
 * components. We render it for real under jsdom (the same env the
 * `useElapsedTime` hook test uses) with `@tanstack/react-query` and the tRPC
 * client mocked, so the queries resolve synchronously and the mutation calls are
 * observable.
 *
 * `@tanstack/react-query` lives in `web/node_modules` (not resolvable from the
 * test's location), so — like `stats-page.test.ts` — we mock it via `vi.mock`
 * with `vi.hoisted` fns rather than importing it statically. JSX is avoided (per
 * the step-component test convention) by rendering through `createElement`.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockUseQuery, mockUseMutation, mockUpdate } = vi.hoisted(() => ({
	mockUseQuery: vi.fn(),
	mockUseMutation: vi.fn(),
	mockUpdate: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: mockUseQuery,
	useMutation: mockUseMutation,
	useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/lib/trpc.js', () => ({
	trpc: {
		auth: { me: { queryOptions: () => ({ queryKey: ['auth.me'] }) } },
		projects: {
			getById: {
				queryOptions: (input: { id: string }) => ({ queryKey: ['projects.getById', input] }),
			},
			defaults: { queryOptions: () => ({ queryKey: ['projects.defaults'] }) },
			listFull: { queryOptions: () => ({ queryKey: ['projects.listFull'] }) },
		},
	},
	trpcClient: {
		projects: { update: { mutate: mockUpdate }, rebuildWorkerImage: { mutate: vi.fn() } },
	},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
	ProjectWorkerImage,
	WORKER_IMAGE_POLL_MS,
	workerImagePollInterval,
} from '../../../web/src/components/projects/project-worker-image.js';

const GLOBAL_DEFAULT = 'ghcr.io/mongrel-intelligence/cascade-worker:latest';

interface WorkerImageRow {
	workerImage: string | null;
	workerImageDigest: string | null;
	workerImageStatus: string | null;
	workerImageError: string | null;
}

/**
 * Wire the mocked react-query hooks. `useQuery` dispatches on the first
 * queryKey segment (auth.me / projects.getById / projects.defaults);
 * `useMutation` returns a `mutate` that synchronously invokes the component's
 * `mutationFn` (so `trpcClient.projects.update.mutate` is observable) and then
 * the per-call `onSuccess` callback.
 */
function configure(opts: {
	role?: string;
	project?: Partial<WorkerImageRow> | null;
	defaults?: { workerImage: string };
}): void {
	mockUseQuery.mockImplementation((options: { queryKey: unknown[] }) => {
		const key = (options.queryKey as string[])[0];
		if (key === 'auth.me') {
			return { data: opts.role ? { role: opts.role } : undefined };
		}
		if (key === 'projects.getById') {
			return { data: opts.project ?? undefined };
		}
		if (key === 'projects.defaults') {
			return { data: opts.defaults ?? { workerImage: GLOBAL_DEFAULT } };
		}
		return { data: undefined };
	});

	mockUseMutation.mockImplementation(
		(options: { mutationFn: (v: unknown) => Promise<unknown> }) => ({
			mutate: (vars: unknown, cbs?: { onSuccess?: () => void }) => {
				options.mutationFn(vars);
				cbs?.onSuccess?.();
			},
			isPending: false,
		}),
	);
}

afterEach(cleanup);

describe('ProjectWorkerImage', () => {
	it('renders the global default as placeholder when unset', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: null,
				workerImageStatus: null,
				workerImageDigest: null,
				workerImageError: null,
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		// An unset project derives source `default`; pick "Referenced image" to
		// reveal the spec-022 reference input.
		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'reference' } });
		const input = screen.getByLabelText('Image reference') as HTMLInputElement;
		expect(input.placeholder).toContain(GLOBAL_DEFAULT);
	});

	it('submitting a reference calls projects.update with workerImage', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: null,
				workerImageStatus: null,
				workerImageDigest: null,
				workerImageError: null,
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		// An unset project derives source `default`; pick "Referenced image" first.
		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'reference' } });
		fireEvent.change(screen.getByLabelText('Image reference'), {
			target: { value: 'my-registry/img:1' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Set' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerImage: 'my-registry/img:1' });
	});

	it('clear calls projects.update with workerImage null', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: 'reg/img:1',
				workerImageStatus: 'verified',
				workerImageDigest: 'sha256:abc',
				workerImageError: null,
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerImage: null });
	});

	it('shows pending (verifying…) and polls while status is pending', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: 'reg/img:1',
				workerImageStatus: 'pending',
				workerImageDigest: null,
				workerImageError: null,
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		expect(screen.getByText(/verifying/i)).toBeTruthy();
		// The polling predicate schedules a refetch while pending and stops once
		// the lifecycle resolves (verified / failed) or there is no per-project image.
		expect(workerImagePollInterval('pending')).toBe(WORKER_IMAGE_POLL_MS);
		expect(workerImagePollInterval('verified')).toBe(false);
		expect(workerImagePollInterval('failed')).toBe(false);
		expect(workerImagePollInterval(null)).toBe(false);
	});

	it('shows verified state with the pinned digest', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: 'reg/img:1',
				workerImageStatus: 'verified',
				workerImageDigest: 'sha256:deadbeef',
				workerImageError: null,
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		expect(screen.getByText(/verified/i)).toBeTruthy();
		expect(screen.getByText(/sha256:deadbeef/)).toBeTruthy();
	});

	it('shows failed state with the error reason', () => {
		configure({
			role: 'superadmin',
			project: {
				workerImage: 'reg/img:1',
				workerImageStatus: 'failed',
				workerImageDigest: null,
				workerImageError: 'missing cascade-tools',
			},
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		expect(screen.getByText(/failed/i)).toBeTruthy();
		expect(screen.getByText(/missing cascade-tools/)).toBeTruthy();
	});

	it('the control is hidden for a non-superadmin', () => {
		configure({
			role: 'admin',
			project: {
				workerImage: 'reg/img:1',
				workerImageStatus: 'verified',
				workerImageDigest: 'sha256:abc',
				workerImageError: null,
			},
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));
		expect(container.firstChild).toBeNull();
		expect(screen.queryByText('Worker Image')).toBeNull();
	});
});
