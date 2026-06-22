import type { PMProvider } from './types.js';

const MESSAGE =
	'This project has no PM provider configured (SCM-only project). PM operations are unavailable.';

function rejectNoPM(): Promise<never> {
	return Promise.reject(new Error(MESSAGE));
}

function throwNoPM(): never {
	throw new Error(MESSAGE);
}

/**
 * Sentinel `PMProvider` for SCM-only projects (a project with an SCM integration
 * but no PM provider).
 *
 * `pmRegistry.createProvider` returns this when `project.pm` is undefined, so
 * `withPMProvider(provider, fn)` — which requires a non-null `PMProvider` — stays
 * type-safe and SCM dispatch never resolves a phantom Trello provider (the bug this
 * fixes). Every PM operation fails loudly: a PM-less project should never reach one.
 * SCM trigger handlers that opportunistically enrich via `getPMProviderOrNull()`
 * already wrap such calls in try/catch and degrade gracefully.
 */
export const NO_PM_PROVIDER: PMProvider = {
	type: 'none',

	getWorkItem: () => rejectNoPM(),
	getWorkItemComments: () => rejectNoPM(),
	updateWorkItem: () => rejectNoPM(),
	addComment: () => rejectNoPM(),
	updateComment: () => rejectNoPM(),
	createWorkItem: () => rejectNoPM(),
	listWorkItems: () => rejectNoPM(),

	moveWorkItem: () => rejectNoPM(),
	addLabel: () => rejectNoPM(),
	removeLabel: () => rejectNoPM(),

	getChecklists: () => rejectNoPM(),
	createChecklist: () => rejectNoPM(),
	addChecklistItem: () => rejectNoPM(),
	updateChecklistItem: () => rejectNoPM(),
	deleteChecklistItem: () => rejectNoPM(),

	getAttachments: () => rejectNoPM(),
	addAttachment: () => rejectNoPM(),
	addAttachmentFile: () => rejectNoPM(),
	getCustomFieldNumber: () => rejectNoPM(),
	updateCustomFieldNumber: () => rejectNoPM(),

	linkPR: () => rejectNoPM(),

	getWorkItemUrl: () => throwNoPM(),
	getAuthenticatedUser: () => rejectNoPM(),
};
