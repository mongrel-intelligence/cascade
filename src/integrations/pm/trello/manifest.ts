/**
 * Trello PM provider manifest.
 *
 * Wires the existing Trello implementation (TrelloIntegration, Trello
 * router adapter, Trello triggers, TrelloPlatformClient) into the
 * PMProviderManifest contract landed in plan 006/1.
 *
 * Signing: Trello uses HMAC-SHA1(rawBody + callbackUrl), NOT the shared
 * HMAC-SHA256 factory. The manifest wires the existing
 * `verifyTrelloSignature` helper from `src/webhook/signatureVerification.ts`
 * and reconstructs the callback URL from `host` + `x-forwarded-proto`
 * headers — consistent with how the router has always verified Trello
 * webhooks (`src/router/webhookVerification.ts`).
 */

import { parseContainerId, parseLabelId } from '../../../pm/ids.js';
import { TrelloIntegration } from '../../../pm/trello/integration.js';
import type {
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
} from '../../../pm/types.js';
import { TrelloRouterAdapter } from '../../../router/adapters/trello.js';
import { TrelloPlatformClient } from '../../../router/platformClients/trello.js';
import { buildTrelloCallbackUrl } from '../../../router/webhookVerification.js';
import { trelloClient, withTrelloCredentials } from '../../../trello/client.js';
import { TrelloCommentMentionTrigger } from '../../../triggers/trello/comment-mention.js';
import { ReadyToProcessLabelTrigger } from '../../../triggers/trello/label-added.js';
import {
	TrelloStatusChangedBacklogTrigger,
	TrelloStatusChangedMergedTrigger,
	TrelloStatusChangedPlanningTrigger,
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from '../../../triggers/trello/status-changed.js';
import { verifyTrelloSignature } from '../../../webhook/signatureVerification.js';
import type { PMProviderManifest, WebhookVerifier } from '../manifest.js';
import { trelloConfigSchema } from './config-schema.js';

const TRELLO_SIGNATURE_HEADER = 'x-trello-webhook';

const verifyTrelloWebhookSignatureViaManifest: WebhookVerifier = (rawBody, headers, secret) => {
	if (secret === null) return true; // opt-out matches existing router behavior

	const signature = readHeader(headers, TRELLO_SIGNATURE_HEADER);
	if (!signature) return false;

	const host = readHeader(headers, 'host');
	const proto = readHeader(headers, 'x-forwarded-proto');
	const callbackUrl = buildTrelloCallbackUrl(host, proto);

	return verifyTrelloSignature(rawBody, callbackUrl, signature, secret);
};

function readHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
	if (headers[name] !== undefined) return headers[name];
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === name) return headers[key];
	}
	return undefined;
}

const trelloIntegration = new TrelloIntegration();

export const trelloManifest: PMProviderManifest = {
	id: 'trello',
	label: 'Trello',
	category: 'pm',

	credentialRoles: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
		{ role: 'token', label: 'Token', envVarKey: 'TRELLO_TOKEN' },
		{ role: 'api_secret', label: 'API Secret', envVarKey: 'TRELLO_API_SECRET', optional: true },
	],

	webhookRoute: '/trello/webhook',
	verifyWebhookSignature: verifyTrelloWebhookSignatureViaManifest,

	routerAdapter: new TrelloRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'trello') return null;
		return d.projectId ?? null;
	},

	pmIntegration: trelloIntegration,

	triggerHandlers: [
		new TrelloCommentMentionTrigger(),
		TrelloStatusChangedSplittingTrigger,
		TrelloStatusChangedPlanningTrigger,
		TrelloStatusChangedTodoTrigger,
		TrelloStatusChangedBacklogTrigger,
		TrelloStatusChangedMergedTrigger,
		new ReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new TrelloPlatformClient(projectId),

	// ── Plan 010/1 mutation hooks ──────────────────────────────────────
	createLabel: async ({ credentials, containerId, name, color }) => {
		const apiKey = credentials.api_key ?? '';
		const token = credentials.token ?? '';
		return withTrelloCredentials({ apiKey, token }, () =>
			trelloClient.createBoardLabel(containerId, name, color ?? 'blue'),
		);
	},

	createCustomField: async ({ credentials, containerId, name }) => {
		const apiKey = credentials.api_key ?? '';
		const token = credentials.token ?? '';
		// Trello custom fields default to 'number' type for CASCADE's use
		// case (cost tracking). Future: accept type in the input shape.
		return withTrelloCredentials({ apiKey, token }, () =>
			trelloClient.createBoardCustomField(containerId, name, 'number'),
		);
	},

	// ── Plan 009/2 behavioral contract fields ─────────────────────────
	lifecycle: { enabled: true, fixtureKey: 'trello' },

	wizardSpec: {
		steps: [
			{ kind: 'credentials', id: 'trello-credentials' },
			{ kind: 'container-pick', id: 'trello-board' },
			{ kind: 'label-mapping', id: 'trello-labels' },
			{ kind: 'status-mapping', id: 'trello-statuses' },
			{ kind: 'webhook-url-display', id: 'trello-webhook' },
		],
	},

	configSchema: trelloConfigSchema,
	configFixture: {
		boardId: 'trello-fixture-board',
		lists: { backlog: 'list-bl', todo: 'list-td', done: 'list-dn' },
		labels: { bug: 'label-red', feature: 'label-grn' },
		customFields: { cost: 'cf-cost' },
	},

	/**
	 * Trello's discovery surface: list the user's boards, enumerate labels
	 * on a board, and expose custom-field metadata for the wizard. `states`
	 * isn't declared because Trello has no native state concept — lists
	 * serve both container and status roles, and list lookup lives inside
	 * `boards`. `containers` isn't declared because in Trello's model it
	 * would be redundant with `boards`.
	 */
	discoveryCapabilities: {
		boards: true,
		labels: true,
		customFields: true,
	},

	/**
	 * Produce a discovery-scoped PMProvider. The factory binds the
	 * provided credentials into Trello's AsyncLocalStorage scope via
	 * `withTrelloCredentials`, so the singleton trelloClient doesn't need
	 * per-call credential threading.
	 *
	 * Accepts `credentials` as a `Record<string, string>` shaped by
	 * credentialRoles — the tRPC discover endpoint provides this from
	 * the wizard's collected inputs.
	 */
	createDiscoveryProvider: (opts) => {
		const creds = opts?.credentials ?? {};
		const apiKey = creds.api_key ?? '';
		const token = creds.token ?? '';

		const runWithCreds = <T>(fn: () => Promise<T>): Promise<T> =>
			withTrelloCredentials({ apiKey, token }, fn);

		const provider: Pick<PMProvider, 'type' | 'discover'> = {
			type: 'trello',
			async discover<K extends DiscoveryCapability>(
				capability: K,
				args: DiscoveryArgs<K>,
			): Promise<DiscoveryResult<K>> {
				switch (capability) {
					case 'boards': {
						const boards = await runWithCreds(() => trelloClient.getBoards());
						const out = boards.map((b) => ({
							id: parseContainerId(b.id),
							name: b.name,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'labels': {
						const a = args as { containerId: string };
						const labels = await runWithCreds(() => trelloClient.getBoardLabels(a.containerId));
						const out = labels.map((l) => ({
							id: parseLabelId(l.id),
							name: l.name,
							color: l.color,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'customFields': {
						const a = args as { containerId: string };
						const fields = await runWithCreds(() =>
							trelloClient.getBoardCustomFields(a.containerId),
						);
						const out = fields.map((f) => ({
							id: f.id,
							name: f.name,
							type: f.type,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					default:
						throw new Error(
							`Trello provider does not support discovery capability '${capability}'`,
						);
				}
			},
		};

		return provider as PMProvider;
	},
};
