import { vi } from 'vitest';

import type { MediaReference } from '../../src/pm/types.js';

/**
 * Stable deterministic timestamp the mock provider stamps onto generated
 * fixtures (work items, comments). Tests that need to assert exact
 * timestamps can reach for this constant rather than calling
 * `new Date().toISOString()` (which changes per test run).
 *
 * MNG-1422: introduced alongside the mutation-result contracts so tests can
 * verify provider timestamps flow through to `WorkItem.updatedAt` /
 * `WorkItemComment.updatedAt` without timer mocking.
 */
export const MOCK_PROVIDER_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/**
 * Build a minimal WorkItem fixture with deterministic timestamps. Provided
 * as a sibling helper to `createMockPMProvider` so callers stamping
 * `getWorkItem.mockResolvedValue(...)` don't have to remember the field
 * names. Override the returned object as needed.
 */
export function createMockWorkItem(
	overrides?: Partial<{
		id: string;
		title: string;
		description: string;
		url: string;
		status: string;
		statusId: string;
		labels: Array<{ id: string; name: string; color?: string }>;
		inlineMedia: MediaReference[];
		createdAt: string;
		updatedAt: string;
	}>,
) {
	return {
		id: 'mock-item-1',
		title: 'Mock work item',
		description: '',
		url: 'mock://workitem/mock-item-1',
		labels: [],
		createdAt: MOCK_PROVIDER_TIMESTAMP,
		updatedAt: MOCK_PROVIDER_TIMESTAMP,
		...overrides,
	};
}

/**
 * Build a minimal WorkItemComment fixture with deterministic timestamps.
 */
export function createMockWorkItemComment(
	overrides?: Partial<{
		id: string;
		date: string;
		text: string;
		author: { id: string; name: string; username: string };
		inlineMedia: MediaReference[];
		createdAt: string;
		updatedAt: string;
	}>,
) {
	return {
		id: 'mock-comment-1',
		date: MOCK_PROVIDER_TIMESTAMP,
		text: '',
		author: { id: 'mock-user', name: 'Mock User', username: 'mock' },
		createdAt: MOCK_PROVIDER_TIMESTAMP,
		updatedAt: MOCK_PROVIDER_TIMESTAMP,
		...overrides,
	};
}

/**
 * Creates a mock PMProvider with all methods stubbed as vi.fn().
 * Use this factory instead of copy-pasting the mock object in every test file.
 *
 * @example
 * ```ts
 * const mockProvider = createMockPMProvider();
 * vi.mock('../../src/pm/index.js', () => ({
 *   getPMProvider: vi.fn(() => mockProvider),
 * }));
 * ```
 *
 * The `getWorkItem` mock returns a work item without `inlineMedia` by default.
 * Override `getWorkItem` to return a work item with `inlineMedia` for testing
 * image injection:
 *
 * ```ts
 * mockProvider.getWorkItem.mockResolvedValue({
 *   ...baseItem,
 *   inlineMedia: [{ url: '...', mimeType: 'image/png', source: 'description' }],
 * });
 * ```
 *
 * Companion helpers `createMockWorkItem` / `createMockWorkItemComment` stamp
 * deterministic `createdAt` / `updatedAt` values from `MOCK_PROVIDER_TIMESTAMP`
 * — use them when asserting on the new optional timestamp fields (MNG-1422).
 */
export function createMockPMProvider() {
	return {
		type: 'trello' as const,
		getWorkItem: vi.fn(),
		getChecklists: vi.fn(),
		getAttachments: vi.fn(),
		getWorkItemComments:
			vi.fn<
				() => Promise<
					Array<{
						id: string;
						date: string;
						text: string;
						author: { id: string; name: string; username: string };
						inlineMedia?: MediaReference[];
						createdAt?: string;
						updatedAt?: string;
					}>
				>
			>(),
		updateWorkItem: vi.fn(),
		addComment: vi.fn().mockResolvedValue(''),
		updateComment: vi.fn(),
		createWorkItem: vi.fn(),
		listWorkItems: vi.fn(),
		moveWorkItem: vi.fn(),
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
		deleteChecklistItem: vi.fn(),
		addAttachment: vi.fn(),
		addAttachmentFile: vi.fn(),
		linkPR: vi.fn().mockResolvedValue(undefined),
		getCustomFieldNumber: vi.fn(),
		updateCustomFieldNumber: vi.fn(),
		getWorkItemUrl: vi.fn(),
		getAuthenticatedUser: vi.fn(),
	};
}
