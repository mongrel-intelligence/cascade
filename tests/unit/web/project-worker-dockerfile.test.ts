// @vitest-environment jsdom
/**
 * Tests for the dashboard Worker Image control's Dockerfile source (spec 023
 * plan 5/5, MNG-1725) — the follow-up to the spec-022 reference-image control.
 *
 * Like `project-worker-image.test.ts`, `ProjectWorkerImage` is hook-heavy so it
 * is rendered for real under jsdom with `@tanstack/react-query` + the tRPC
 * client mocked (queries resolve synchronously, mutation calls are observable).
 * `@tanstack/react-query` lives in `web/node_modules` so it is mocked via
 * `vi.mock` + `vi.hoisted` rather than imported statically, and JSX is avoided
 * via `createElement`.
 *
 * Covers: the Dockerfile textarea renders (and the reference input is hidden)
 * for the dockerfile source; Set → `projects.update({workerDockerfile})`; Clear
 * → `null`; the build-status lifecycle (building spinner; the no-strand
 * "Verified … · last rebuild failed" split; a first-build failure); polling
 * while a build is in flight; the Rebuild button → `projects.rebuildWorkerImage`;
 * and the superadmin gate.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockUseQuery, mockUseMutation, mockUpdate, mockRebuild } = vi.hoisted(() => ({
	mockUseQuery: vi.fn(),
	mockUseMutation: vi.fn(),
	mockUpdate: vi.fn(),
	mockRebuild: vi.fn(),
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
		projects: {
			update: { mutate: mockUpdate },
			rebuildWorkerImage: { mutate: mockRebuild },
		},
	},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
	deriveWorkerImageSource,
	ProjectWorkerImage,
	WORKER_IMAGE_POLL_MS,
	workerImagePollInterval,
} from '../../../web/src/components/projects/project-worker-image.js';

const GLOBAL_DEFAULT = 'ghcr.io/mongrel-intelligence/cascade-worker:latest';
const DOCKERFILE = 'RUN sudo apt-get update && sudo apt-get install -y protobuf-compiler';

interface WorkerImageRow {
	workerImage: string | null;
	workerImageDigest: string | null;
	workerImageStatus: string | null;
	workerImageError: string | null;
	workerDockerfile: string | null;
	workerImageBuildStatus: string | null;
}

/** A dockerfile-sourced project row with overridable lifecycle columns. */
function dockerfileProject(overrides: Partial<WorkerImageRow> = {}): WorkerImageRow {
	return {
		workerImage: null,
		workerImageDigest: null,
		workerImageStatus: null,
		workerImageError: null,
		workerDockerfile: DOCKERFILE,
		workerImageBuildStatus: null,
		...overrides,
	};
}

/** A reference-sourced project row (spec 022). */
function referenceProject(overrides: Partial<WorkerImageRow> = {}): WorkerImageRow {
	return {
		workerImage: 'reg/img:1',
		workerImageDigest: 'sha256:abc',
		workerImageStatus: 'verified',
		workerImageError: null,
		workerDockerfile: null,
		workerImageBuildStatus: null,
		...overrides,
	};
}

/**
 * Wire the mocked react-query hooks (same shape as `project-worker-image.test`).
 * `useMutation` returns a `mutate` that synchronously invokes the component's
 * `mutationFn` (so the trpcClient call is observable) then the per-call
 * `onSuccess`.
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

describe('ProjectWorkerImage — Dockerfile source (spec 023)', () => {
	it('renders the Dockerfile textarea and hides the reference input for a dockerfile project', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		expect(screen.getByLabelText('Dockerfile extra layers')).toBeTruthy();
		// Mutual exclusivity: the reference-image input is not rendered.
		expect(screen.queryByLabelText('Image reference')).toBeNull();
	});

	it('selecting the Dockerfile source hides the reference-image control', () => {
		configure({ role: 'superadmin', project: referenceProject() });
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// A reference project starts on the reference input.
		expect(screen.getByLabelText('Image reference')).toBeTruthy();

		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'dockerfile' } });

		expect(screen.queryByLabelText('Image reference')).toBeNull();
		expect(screen.getByLabelText('Dockerfile extra layers')).toBeTruthy();
	});

	it('Set calls projects.update with the edited workerDockerfile content', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		fireEvent.change(screen.getByLabelText('Dockerfile extra layers'), {
			target: { value: 'RUN echo layered' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Set' }));

		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerDockerfile: 'RUN echo layered' });
	});

	it('Clear calls projects.update with workerDockerfile null', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerDockerfile: null });
	});

	it('renders a Building… spinner for a first build (status building, no pin yet)', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'building',
				workerImageBuildStatus: 'building',
			}),
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		expect(screen.getByText(/building/i)).toBeTruthy();
		expect(container.querySelector('[data-status="building"]')).toBeTruthy();
		expect(container.querySelector('.animate-spin')).toBeTruthy();
	});

	it('keeps the active image Verified while a rebuild is in flight (build spinner)', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
				workerImageBuildStatus: 'building',
			}),
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// Active image reads Verified; the rebuild attempt is a separate spinner.
		expect(container.querySelector('[data-status="verified"]')).toBeTruthy();
		expect(screen.getByText(/rebuilding/i)).toBeTruthy();
		expect(container.querySelector('[data-build-status="building"]')).toBeTruthy();
		expect(container.querySelector('.animate-spin')).toBeTruthy();
	});

	it('distinguishes a failed REBUILD from the active image (Verified · last rebuild failed)', () => {
		const reason = 'runtime requirement missing (exit 1): FAIL: cascade-tools not found';
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
				workerImageBuildStatus: 'failed',
				workerImageError: reason,
			}),
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// The active image stays Verified — NOT a misleading top-level "Failed".
		expect(container.querySelector('[data-status="verified"]')).toBeTruthy();
		expect(container.querySelector('[data-status="failed"]')).toBeNull();
		expect(screen.getByText(/pinned to local-img-1/)).toBeTruthy();
		expect(screen.getByText(/last rebuild failed/i)).toBeTruthy();
		expect(screen.getByText(/cascade-tools not found/)).toBeTruthy();
	});

	it('renders a failed badge for a first-build failure (status failed)', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'failed',
				workerImageBuildStatus: 'failed',
				workerImageError: 'build failed: unexpected token',
			}),
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		expect(container.querySelector('[data-status="failed"]')).toBeTruthy();
		expect(container.querySelector('[data-status="verified"]')).toBeNull();
		expect(screen.getByText(/build failed: unexpected token/)).toBeTruthy();
	});

	it('polls while any build/validation is in flight and stops once settled', () => {
		// Reference validation (spec 022) still polls.
		expect(workerImagePollInterval('pending')).toBe(WORKER_IMAGE_POLL_MS);
		// A first Dockerfile build (launchable status building) polls.
		expect(workerImagePollInterval('building')).toBe(WORKER_IMAGE_POLL_MS);
		// A rebuild while the pin stays verified polls (no-strand).
		expect(workerImagePollInterval('verified', 'building')).toBe(WORKER_IMAGE_POLL_MS);
		// Settled states stop polling — including a failed rebuild on a verified pin.
		expect(workerImagePollInterval('verified', 'failed')).toBe(false);
		expect(workerImagePollInterval('verified', null)).toBe(false);
		expect(workerImagePollInterval('failed', 'failed')).toBe(false);
		expect(workerImagePollInterval(null)).toBe(false);
	});

	it('the Rebuild button triggers projects.rebuildWorkerImage', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

		expect(mockRebuild).toHaveBeenCalledWith({ projectId: 'p1' });
	});

	it('disables Rebuild (with a hint) while the textarea diverges from the saved Dockerfile', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// Unedited: Rebuild is enabled — it rebuilds the persisted Dockerfile.
		expect((screen.getByRole('button', { name: 'Rebuild' }) as HTMLButtonElement).disabled).toBe(
			false,
		);

		// Edit the textarea so the draft diverges from the saved content.
		fireEvent.change(screen.getByLabelText('Dockerfile extra layers'), {
			target: { value: `${DOCKERFILE}\nRUN echo more` },
		});

		// Rebuild is now disabled (it would ignore the unsaved edits) and a hint
		// directs the operator to Set first.
		expect((screen.getByRole('button', { name: 'Rebuild' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByText(/click Set to save your edits first/i)).toBeTruthy();
	});

	it('re-enables Rebuild once the textarea matches the saved Dockerfile again', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		const textarea = screen.getByLabelText('Dockerfile extra layers');
		fireEvent.change(textarea, { target: { value: 'RUN echo diverged' } });
		expect((screen.getByRole('button', { name: 'Rebuild' }) as HTMLButtonElement).disabled).toBe(
			true,
		);

		// Typing the saved content back removes the divergence.
		fireEvent.change(textarea, { target: { value: DOCKERFILE } });
		expect((screen.getByRole('button', { name: 'Rebuild' }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(screen.queryByText(/click Set to save your edits first/i)).toBeNull();
	});

	it('does not falsely claim the default is in use while a Dockerfile override is persisted', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// Manually pick "Global default" while the Dockerfile override is still saved.
		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'default' } });

		// It must NOT claim the default is in use — the override still drives runs.
		expect(screen.queryByText(/Using the global default worker image/i)).toBeNull();
		expect(screen.getByText(/override is still configured/i)).toBeTruthy();

		// The surfaced Clear action performs the real revert (clears the Dockerfile).
		fireEvent.click(screen.getByRole('button', { name: 'Clear override' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerDockerfile: null });
	});

	it('clears a persisted reference override from the Global default view', () => {
		configure({ role: 'superadmin', project: referenceProject() });
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'default' } });

		expect(screen.queryByText(/Using the global default worker image/i)).toBeNull();
		expect(screen.getByText(/override is still configured/i)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Clear override' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerImage: null });
	});

	it('does not falsely claim the default in the Referenced-image view while a Dockerfile override is persisted', () => {
		configure({
			role: 'superadmin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// Switch to "Referenced image" while the Dockerfile override is still saved.
		// `workerImage` is null (backend mutual exclusivity), so the reference input
		// is empty — but the persisted Dockerfile still drives every run.
		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'reference' } });

		// The empty reference input must NOT report "Unset — using the global default".
		expect(screen.queryByText(/Unset — using the global default/i)).toBeNull();
		expect(screen.getByText(/override is still configured/i)).toBeTruthy();

		// The surfaced Clear action performs the real revert (clears the Dockerfile).
		fireEvent.click(screen.getByRole('button', { name: 'Clear override' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerDockerfile: null });
	});

	it('surfaces the active reference override in the Dockerfile view (no false empty state)', () => {
		configure({ role: 'superadmin', project: referenceProject() });
		render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		// Switch to "Dockerfile" while a referenced image is still saved. The
		// textarea is empty (backend mutual exclusivity nulls `workerDockerfile`),
		// but the referenced image still drives every run.
		fireEvent.change(screen.getByLabelText('Image source'), { target: { value: 'dockerfile' } });

		expect(screen.getByLabelText('Dockerfile extra layers')).toBeTruthy();
		expect(screen.getByText(/override is still configured/i)).toBeTruthy();

		// The surfaced Clear action performs the real revert (clears the reference).
		fireEvent.click(screen.getByRole('button', { name: 'Clear override' }));
		expect(mockUpdate).toHaveBeenCalledWith({ id: 'p1', workerImage: null });
	});

	it('the control is hidden for a non-superadmin', () => {
		configure({
			role: 'admin',
			project: dockerfileProject({
				workerImageStatus: 'verified',
				workerImageDigest: 'local-img-1',
			}),
		});
		const { container } = render(createElement(ProjectWorkerImage, { projectId: 'p1' }));

		expect(container.firstChild).toBeNull();
		expect(screen.queryByText('Worker Image')).toBeNull();
	});

	it('derives the effective image source from the two source columns', () => {
		expect(deriveWorkerImageSource({ workerImage: null, workerDockerfile: DOCKERFILE })).toBe(
			'dockerfile',
		);
		expect(deriveWorkerImageSource({ workerImage: 'reg/img:1', workerDockerfile: null })).toBe(
			'reference',
		);
		expect(deriveWorkerImageSource({ workerImage: null, workerDockerfile: null })).toBe('default');
	});
});
