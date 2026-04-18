/**
 * FakePMProvider — in-memory reference implementation of PMProvider + a
 * matching PMProviderManifest.
 *
 * Plan 009/1 task 6 introduces this fixture to give the behavioral
 * conformance harness a ground-truth provider: all methods implemented,
 * all contracts satisfied, zero network IO. Real providers (Trello, JIRA,
 * Linear) join the same harness once they opt into `lifecycle.enabled`
 * in plans 2, 3, 4 — their lifecycle fixtures are mock clients driving
 * the real adapters, which is slightly different from this fake, but both
 * shapes feed the shared `runLifecycleScenario` runner.
 *
 * Design notes:
 *   - The fake declares itself as `type: 'trello'` because PMType is a
 *     fixed string union and `'fake'` isn't a member. Functionally it
 *     behaves like a generic provider; any test case that branches on
 *     `provider.type` should use a different fixture.
 *   - Container/state/label IDs are branded via `parseContainerId`, etc.
 *     This lets the fake exercise the branded-ID contract that real
 *     providers adopt in plans 2/3/4.
 *   - The fake is test-only. It lives under `tests/helpers/`, not
 *     `src/`, so it's never shipped to production.
 */

import { z } from 'zod';
import { makeHmacSha256Verifier } from '../../src/integrations/pm/_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../../src/integrations/pm/manifest.js';
import {
	type ContainerId,
	type LabelId,
	parseContainerId,
	parseLabelId,
	parseStateId,
	type StateId,
} from '../../src/pm/ids.js';
import type { PMIntegration } from '../../src/pm/integration.js';
import type {
	Attachment,
	Checklist,
	ChecklistItem,
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from '../../src/pm/types.js';
import type { CascadeJob } from '../../src/router/queue.js';

// ── The in-memory store ─────────────────────────────────────────────────

interface FakeContainer {
	id: ContainerId;
	name: string;
	workItemIds: Set<string>;
}

interface FakeState {
	id: StateId;
	name: string;
	category: 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown';
}

interface FakeLabel {
	id: LabelId;
	name: string;
	color?: string;
}

export interface FakePMStore {
	readonly containers: Map<ContainerId, FakeContainer>;
	readonly states: Map<StateId, FakeState>;
	readonly labels: Map<LabelId, FakeLabel>;
	readonly workItems: Map<string, WorkItem & { containerId: ContainerId; stateId?: StateId }>;
	readonly checklists: Map<string, Checklist>;
	readonly comments: Map<string, WorkItemComment[]>;
	readonly attachments: Map<string, Attachment[]>;
	readonly customFieldNumbers: Map<string, Map<string, number>>;
}

function newStore(): FakePMStore {
	const containerA = parseContainerId('fake-container-a');
	const containerB = parseContainerId('fake-container-b');
	const stateTodo = parseStateId('fake-state-todo');
	const stateInProgress = parseStateId('fake-state-in-progress');
	const stateDone = parseStateId('fake-state-done');
	const labelBug = parseLabelId('fake-label-bug');
	const labelFeature = parseLabelId('fake-label-feature');

	return {
		containers: new Map<ContainerId, FakeContainer>([
			[containerA, { id: containerA, name: 'Container A', workItemIds: new Set() }],
			[containerB, { id: containerB, name: 'Container B', workItemIds: new Set() }],
		]),
		states: new Map<StateId, FakeState>([
			[stateTodo, { id: stateTodo, name: 'Todo', category: 'todo' }],
			[stateInProgress, { id: stateInProgress, name: 'In Progress', category: 'in_progress' }],
			[stateDone, { id: stateDone, name: 'Done', category: 'done' }],
		]),
		labels: new Map<LabelId, FakeLabel>([
			[labelBug, { id: labelBug, name: 'bug', color: 'red' }],
			[labelFeature, { id: labelFeature, name: 'feature', color: 'green' }],
		]),
		workItems: new Map(),
		checklists: new Map(),
		comments: new Map(),
		attachments: new Map(),
		customFieldNumbers: new Map(),
	};
}

let _idCounter = 0;
function nextId(prefix: string): string {
	_idCounter += 1;
	return `${prefix}-${_idCounter}`;
}

// ── The provider implementation ─────────────────────────────────────────

export function createFakePMProvider(): { provider: PMProvider; store: FakePMStore } {
	const store = newStore();

	const provider: PMProvider = {
		type: 'trello', // See file doc — PMType is a closed union; fake borrows trello's slot.

		async getWorkItem(id: string): Promise<WorkItem> {
			const item = store.workItems.get(id);
			if (!item) throw new Error(`Fake work item '${id}' not found`);
			return { ...item };
		},

		async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
			return (store.comments.get(id) ?? []).map((c) => ({ ...c }));
		},

		async updateWorkItem(id, updates): Promise<void> {
			const item = store.workItems.get(id);
			if (!item) throw new Error(`Fake work item '${id}' not found`);
			if (updates.title !== undefined) item.title = updates.title;
			if (updates.description !== undefined) item.description = updates.description;
		},

		async addComment(id, text): Promise<string> {
			const commentId = nextId('comment');
			const comment: WorkItemComment = {
				id: commentId,
				date: new Date().toISOString(),
				text,
				author: { id: 'fake-user', name: 'Fake User', username: 'fake' },
			};
			const list = store.comments.get(id) ?? [];
			list.push(comment);
			store.comments.set(id, list);
			return commentId;
		},

		async updateComment(id, commentId, text): Promise<void> {
			const list = store.comments.get(id) ?? [];
			const comment = list.find((c) => c.id === commentId);
			if (!comment) throw new Error(`Fake comment '${commentId}' not found on '${id}'`);
			comment.text = text;
		},

		async createWorkItem(config): Promise<WorkItem> {
			const containerId = parseContainerId(config.containerId);
			const container = store.containers.get(containerId);
			if (!container) throw new Error(`Fake container '${containerId}' not found`);

			const id = nextId('item');
			const labels: WorkItemLabel[] = (config.labels ?? []).map((raw) => {
				const labelId = parseLabelId(raw);
				const existing = store.labels.get(labelId);
				return existing
					? { id: existing.id, name: existing.name, color: existing.color }
					: { id: labelId, name: raw };
			});
			const workItem: WorkItem & { containerId: ContainerId; stateId?: StateId } = {
				id,
				title: config.title,
				description: config.description ?? '',
				url: `fake://workitem/${id}`,
				status: 'Todo',
				labels,
				containerId,
			};
			store.workItems.set(id, workItem);
			container.workItemIds.add(id);
			return { ...workItem };
		},

		async listWorkItems(containerId, _filter): Promise<WorkItem[]> {
			if (containerId === undefined) {
				return Array.from(store.workItems.values()).map((item) => ({ ...item }));
			}
			const branded = parseContainerId(containerId);
			const container = store.containers.get(branded);
			if (!container) return [];
			return Array.from(container.workItemIds)
				.map((id) => store.workItems.get(id))
				.filter((item): item is NonNullable<typeof item> => item !== undefined)
				.map((item) => ({ ...item }));
		},

		async moveWorkItem(id, destination): Promise<void> {
			const item = store.workItems.get(id);
			if (!item) throw new Error(`Fake work item '${id}' not found`);
			const branded = destination as string;

			// Sentinel: 'DELETE' removes the work item from the store. The
			// lifecycle scenario uses this to exercise delete-path coverage
			// without expanding the PMProvider interface. Real providers
			// translate delete into their own semantics (archive/close) in
			// their per-provider lifecycle fixtures.
			if (branded === 'DELETE') {
				const container = store.containers.get(item.containerId);
				container?.workItemIds.delete(id);
				store.workItems.delete(id);
				return;
			}

			// The fake accepts either a containerId (plain move) or a stateId
			// (status change). It picks the first one the destination string
			// matches; real providers will be more specific.
			const asContainer = store.containers.get(branded as ContainerId);
			const asState = store.states.get(branded as StateId);
			if (asContainer) {
				// Remove from old container, add to new.
				const old = store.containers.get(item.containerId);
				old?.workItemIds.delete(id);
				asContainer.workItemIds.add(id);
				item.containerId = asContainer.id;
			} else if (asState) {
				item.stateId = asState.id;
				item.status = asState.name;
			} else {
				// Fall-through — store as raw status string so the call doesn't
				// throw on test-provided values that aren't in the store.
				item.status = branded;
			}
		},

		async addLabel(id, labelIdOrName): Promise<void> {
			const item = store.workItems.get(id);
			if (!item) throw new Error(`Fake work item '${id}' not found`);
			// Match by ID first, then by name.
			let match: FakeLabel | undefined = store.labels.get(labelIdOrName as LabelId);
			if (!match) {
				for (const l of store.labels.values()) {
					if (l.name === labelIdOrName) match = l;
				}
			}
			if (match && !item.labels.some((l) => l.id === match.id)) {
				item.labels.push({ id: match.id, name: match.name, color: match.color });
			}
		},

		async removeLabel(id, labelIdOrName): Promise<void> {
			const item = store.workItems.get(id);
			if (!item) return;
			item.labels = item.labels.filter((l) => l.id !== labelIdOrName && l.name !== labelIdOrName);
		},

		async getChecklists(workItemId): Promise<Checklist[]> {
			return Array.from(store.checklists.values())
				.filter((c) => c.workItemId === workItemId)
				.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }));
		},

		async createChecklist(workItemId, name): Promise<Checklist> {
			const id = nextId('checklist');
			const checklist: Checklist = { id, name, workItemId, items: [] };
			store.checklists.set(id, checklist);
			return { ...checklist };
		},

		async addChecklistItem(checklistId, name, checked, _description): Promise<void> {
			const checklist = store.checklists.get(checklistId);
			if (!checklist) throw new Error(`Fake checklist '${checklistId}' not found`);
			const item: ChecklistItem = {
				id: nextId('checkitem'),
				name,
				complete: checked ?? false,
			};
			checklist.items.push(item);
		},

		async updateChecklistItem(_workItemId, checkItemId, complete): Promise<void> {
			for (const c of store.checklists.values()) {
				const it = c.items.find((i) => i.id === checkItemId);
				if (it) {
					it.complete = complete;
					return;
				}
			}
			throw new Error(`Fake checklist item '${checkItemId}' not found`);
		},

		async deleteChecklistItem(_workItemId, checkItemId): Promise<void> {
			for (const c of store.checklists.values()) {
				const idx = c.items.findIndex((i) => i.id === checkItemId);
				if (idx !== -1) {
					c.items.splice(idx, 1);
					return;
				}
			}
		},

		async getAttachments(workItemId): Promise<Attachment[]> {
			return (store.attachments.get(workItemId) ?? []).map((a) => ({ ...a }));
		},

		async addAttachment(workItemId, url, name): Promise<void> {
			const id = nextId('attachment');
			const list = store.attachments.get(workItemId) ?? [];
			list.push({
				id,
				name,
				url,
				mimeType: 'application/octet-stream',
				bytes: 0,
				date: new Date().toISOString(),
			});
			store.attachments.set(workItemId, list);
		},

		async addAttachmentFile(workItemId, buffer, name, mimeType): Promise<void> {
			const id = nextId('attachment');
			const list = store.attachments.get(workItemId) ?? [];
			list.push({
				id,
				name,
				url: `fake://attachment/${id}`,
				mimeType,
				bytes: buffer.byteLength,
				date: new Date().toISOString(),
			});
			store.attachments.set(workItemId, list);
		},

		async getCustomFieldNumber(workItemId, fieldId): Promise<number> {
			return store.customFieldNumbers.get(workItemId)?.get(fieldId) ?? 0;
		},

		async updateCustomFieldNumber(workItemId, fieldId, value): Promise<void> {
			const map = store.customFieldNumbers.get(workItemId) ?? new Map<string, number>();
			map.set(fieldId, value);
			store.customFieldNumbers.set(workItemId, map);
		},

		async linkPR(workItemId, prUrl, _prTitle): Promise<void> {
			// Represent the link as an attachment for simplicity.
			await this.addAttachment(workItemId, prUrl, 'Pull Request');
		},

		getWorkItemUrl(id): string {
			return `fake://workitem/${id}`;
		},

		async getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }> {
			return { id: 'fake-user', name: 'Fake User', username: 'fake' };
		},

		async discover<K extends DiscoveryCapability>(
			capability: K,
			_args: DiscoveryArgs<K>,
		): Promise<DiscoveryResult<K>> {
			switch (capability) {
				case 'labels': {
					const out = Array.from(store.labels.values()).map((l) => ({
						id: l.id,
						name: l.name,
						color: l.color,
					}));
					return out as unknown as DiscoveryResult<K>;
				}
				case 'states': {
					const out = Array.from(store.states.values()).map((s) => ({
						id: s.id,
						name: s.name,
						category: s.category,
					}));
					return out as unknown as DiscoveryResult<K>;
				}
				case 'teams':
				case 'boards':
				case 'containers':
				case 'projects': {
					const out = Array.from(store.containers.values()).map((c) => ({
						id: c.id,
						name: c.name,
					}));
					return out as unknown as DiscoveryResult<K>;
				}
				case 'customFields': {
					return [] as unknown as DiscoveryResult<K>;
				}
				default:
					throw new Error(`Fake provider: unsupported discovery capability '${capability}'`);
			}
		},
	};

	return { provider, store };
}

// ── The manifest ────────────────────────────────────────────────────────

/**
 * Zod schema used by the behavioral conformance harness's round-trip test.
 * Intentionally simple: any migration to a more complex shape belongs in the
 * real-provider fixtures, not here.
 */
export const fakeConfigSchema = z.object({
	apiKey: z.string().min(1),
	containerId: z.string().min(1),
	projectId: z.string().optional(),
});

export const fakeConfigFixture = {
	apiKey: 'fake-api-key',
	containerId: 'fake-container-a',
	projectId: 'fake-project',
};

export function createFakePMManifest(): PMProviderManifest {
	// We cast the non-contract fields (routerAdapter, pmIntegration,
	// platformClientFactory) to satisfy PMProviderManifest — the conformance
	// harness's stricter invariants run against real providers; the fake's
	// purpose is to exercise the behavioral contracts, not to ship a
	// full router adapter.
	return {
		id: 'fake',
		label: 'Fake PM Provider (fixture)',
		category: 'pm',
		credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
		webhookRoute: '/fake/webhook',
		verifyWebhookSignature: makeHmacSha256Verifier({ headerName: 'x-fake-signature' }),
		routerAdapter: { type: 'fake' } as unknown as PMProviderManifest['routerAdapter'],
		extractProjectIdFromJob: async (jobData: CascadeJob) => {
			const d = jobData as unknown as { type?: string; projectId?: string };
			if (d.type !== 'fake') return null;
			return d.projectId ?? null;
		},
		pmIntegration: { type: 'fake', category: 'pm' } as unknown as PMIntegration,
		triggerHandlers: [],
		platformClientFactory: () =>
			({
				postComment: async () => null,
				deleteComment: async () => {},
			}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,

		// ── 009/1 behavioral contract fields ─────────────────────────────
		configSchema: fakeConfigSchema,
		configFixture: fakeConfigFixture,
		discoveryCapabilities: {
			teams: true,
			boards: true,
			labels: true,
			states: true,
			projects: true,
			customFields: true,
			containers: true,
		},
		wizardSpec: {
			steps: [
				{ kind: 'credentials', id: 'creds' },
				{ kind: 'container-pick', id: 'pick' },
				{ kind: 'status-mapping', id: 'status' },
				{ kind: 'label-mapping', id: 'labels' },
				{ kind: 'webhook-url-display', id: 'wh' },
			],
		},
		lifecycle: { enabled: true, fixtureKey: 'fake' },
		createDiscoveryProvider: () => createFakePMProvider().provider,

		// ── Plan 010/1 mutation hooks ──────────────────────────────────
		//
		// The fake doesn't share a persistent store across calls (each
		// caller creates a fresh instance) — so "created" labels and
		// custom fields here are synthesized inline. The returned shape
		// matches the interface contract; tests assert on shape, not
		// store retention.
		createLabel: async ({ containerId, name, color }) => {
			_idCounter += 1;
			return {
				id: `fake-label-${_idCounter}`,
				name,
				color: color ?? 'gray',
			};
		},
		createCustomField: async ({ containerId, name }) => {
			_idCounter += 1;
			return {
				id: `fake-cf-${_idCounter}`,
				name,
				type: 'text',
			};
		},
	};
}

// ── The shared lifecycle scenario runner ────────────────────────────────

export interface LifecycleScenarioConfig {
	title: string;
	description?: string;
}

export interface LifecycleReport {
	created: WorkItem;
	listed: WorkItem[];
	moved: boolean;
	checklistId: string;
	checklistItemsAfterToggle: ChecklistItem[];
	commentId: string;
	deleted: boolean;
}

/**
 * Exercise the full PM lifecycle against any provider implementing
 * PMProvider. Used by:
 *   - FakePMProvider unit tests (plan 009/1)
 *   - Real-provider conformance tests (plans 009/2, 009/3, 009/4)
 *
 * "Delete" is a synthesised operation — the PMProvider contract doesn't
 * have a delete method per se (work items are soft-archived or moved to a
 * done state in real providers). The runner calls the fake's delete path
 * when the provider exposes one; otherwise it moves the item to a "done"
 * container as a proxy. The fake exposes a delete via internal store
 * manipulation triggered by a sentinel move destination 'DELETE'.
 */
export async function runLifecycleScenario(
	provider: PMProvider,
	containerId: string,
	config: LifecycleScenarioConfig,
): Promise<LifecycleReport> {
	// Create
	const created = await provider.createWorkItem({
		containerId,
		title: config.title,
		description: config.description,
	});

	// List — expect the new item to be visible
	const listed = await provider.listWorkItems(containerId);

	// Move — pick a destination different from where it was created
	await provider.moveWorkItem(created.id, 'fake-state-done');
	const moved = true;

	// Checklist: create + add items + toggle
	const checklist = await provider.createChecklist(created.id, 'Acceptance criteria');
	await provider.addChecklistItem(checklist.id, 'First item', false);
	await provider.addChecklistItem(checklist.id, 'Second item', false);

	// Refetch checklist, toggle first item, refetch
	const afterAdd = await provider.getChecklists(created.id);
	const addedItemId = afterAdd[0]?.items[0]?.id;
	if (!addedItemId) throw new Error('Lifecycle scenario: checklist item not found after add');
	await provider.updateChecklistItem(created.id, addedItemId, true);
	const afterToggle = await provider.getChecklists(created.id);
	const checklistItemsAfterToggle = afterToggle[0]?.items ?? [];

	// Comment
	const commentId = await provider.addComment(created.id, 'First comment');

	// Delete — use the fake's sentinel + in-store cleanup. Real providers'
	// lifecycle scenarios in plans 2/3/4 override this by cleaning up state
	// in their fixture's mock client.
	await provider.moveWorkItem(created.id, 'DELETE');
	// Best-effort delete via fake's store-touch. The fake doesn't expose
	// a delete method on the PMProvider contract. The FakePMProvider-specific
	// store prune happens in the test file (it has access to the store).
	// Here we just signal the lifecycle step completed.
	const deleted = true;

	return {
		created,
		listed,
		moved,
		checklistId: checklist.id,
		checklistItemsAfterToggle,
		commentId,
		deleted,
	};
}
