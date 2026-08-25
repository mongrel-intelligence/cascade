// @vitest-environment jsdom
/**
 * Spec 024 plan 5 — the SCM tab's operator-facing behaviour, rendered.
 *
 * Plan 4's whole operator story is that a topology rejection tells you what to
 * do: *"Repository X is already used by project Y. Set this project as a
 * secondary…"*. That only holds if the tab renders the message verbatim. A
 * later `"Failed to save: " + message` wrap, or a swap to a toast, would
 * destroy it silently — and neither the backend tests nor the payload-builder
 * tests can see that.
 *
 * I originally recorded this as uncoverable "because the dashboard suites have
 * no DOM harness". That was wrong: `project-worker-image.test.ts` and
 * `stats-page.test.ts` render hook-heavy components in this exact directory,
 * and `vitest.config.ts` carries a react-query alias dedupe added to make it
 * work. This follows their convention.
 */
import { cleanup, render, screen } from '@testing-library/react';
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
		projects: {
			getById: {
				queryOptions: (input: { id: string }) => ({ queryKey: ['projects.getById', input] }),
			},
			listFull: { queryOptions: () => ({ queryKey: ['projects.listFull'] }) },
			integrations: {
				list: {
					queryOptions: (input: unknown) => ({ queryKey: ['projects.integrations.list', input] }),
				},
			},
			credentials: {
				list: {
					queryOptions: (input: unknown) => ({ queryKey: ['projects.credentials.list', input] }),
				},
			},
		},
		webhooks: {
			list: { queryOptions: (input: unknown) => ({ queryKey: ['webhooks.list', input] }) },
		},
	},
	trpcClient: {
		projects: { update: { mutate: mockUpdate }, integrations: { upsert: { mutate: vi.fn() } } },
	},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SCMTab } from '../../../web/src/components/projects/integration-scm-tab.js';

/** Plan 4's real rejection text, not a stand-in. */
const REJECTION =
	'Repository "acme/web" is already used by project "frontend". Set this project ' +
	'as a secondary to share the repository, or choose a different one.';

function setup(mutation: Record<string, unknown>) {
	mockUseQuery.mockReturnValue({ data: [], isLoading: false });
	mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, ...mutation });
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('SCMTab — repository role', () => {
	it('shows a secondary project as Secondary, not as Primary', () => {
		// The failure this guards: `repoPrimary` not reaching the dashboard, or a
		// cast turning its absence into `true`, would show a secondary project as
		// Primary — and saving would then try to claim a repository it does not own.
		setup({ isError: false });

		render(
			createElement(SCMTab, {
				projectId: 'p1',
				project: { repo: 'acme/web', repoPrimary: false },
			}),
		);

		const select = screen.getByLabelText('Repository role') as HTMLSelectElement;
		expect(select.value).toBe('secondary');
	});

	it('shows a primary project as Primary', () => {
		setup({ isError: false });

		render(
			createElement(SCMTab, {
				projectId: 'p1',
				project: { repo: 'acme/web', repoPrimary: true },
			}),
		);

		expect((screen.getByLabelText('Repository role') as HTMLSelectElement).value).toBe('primary');
	});

	it('hides the role control for a project with no repository', () => {
		// PM-only projects have no repository to have a role in.
		setup({ isError: false });

		render(createElement(SCMTab, { projectId: 'p1', project: { repo: '' } }));

		expect(screen.queryByLabelText('Repository role')).toBeNull();
	});

	it('renders a topology rejection verbatim', () => {
		// The AC this plan claimed and I had only eyeballed.
		setup({ isError: true, error: new Error(REJECTION) });

		render(
			createElement(SCMTab, {
				projectId: 'p1',
				project: { repo: 'acme/web', repoPrimary: true },
			}),
		);

		expect(screen.getByTestId('scm-save-error').textContent).toBe(REJECTION);
	});

	it('does not wrap or replace the message with generic failure text', () => {
		setup({ isError: true, error: new Error(REJECTION) });

		render(
			createElement(SCMTab, {
				projectId: 'p1',
				project: { repo: 'acme/web', repoPrimary: true },
			}),
		);

		// Addressed by testid, NOT by text: the component has a second error slot
		// (webhook-create) fed by the same mocked hook, so a text query finds the
		// untouched one and a wrap on the SAVE slot slips through. It did — this
		// assertion passed a wrap mutation until it was scoped here.
		expect(screen.getByTestId('scm-save-error').textContent).toBe(REJECTION);
	});
});
