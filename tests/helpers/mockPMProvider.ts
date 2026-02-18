import { vi } from 'vitest';

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
 */
export function createMockPMProvider() {
	return {
		type: 'trello' as const,
		getWorkItem: vi.fn(),
		getChecklists: vi.fn(),
		getAttachments: vi.fn(),
		getWorkItemComments: vi.fn(),
		updateWorkItem: vi.fn(),
		addComment: vi.fn(),
		createWorkItem: vi.fn(),
		listWorkItems: vi.fn(),
		moveWorkItem: vi.fn(),
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
		addAttachment: vi.fn(),
		addAttachmentFile: vi.fn(),
		getCustomFieldNumber: vi.fn(),
		updateCustomFieldNumber: vi.fn(),
		getWorkItemUrl: vi.fn(),
		getAuthenticatedUser: vi.fn(),
	};
}
