import { vi } from 'vitest';

import type { MediaReference } from '../../src/pm/types.js';

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
