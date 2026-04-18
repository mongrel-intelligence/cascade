/**
 * Linear PM provider manifest.
 *
 * Wires the existing Linear implementation into the PMProviderManifest
 * contract. Linear signs webhook bodies with HMAC-SHA256 hex in the
 * `linear-signature` header — no prefix — so the shared
 * `makeHmacSha256Verifier` factory covers it directly.
 *
 * This plan (006/4) also migrates Linear's platform client + bot
 * identity resolver to the canonical `linearAuthHeader` helper and the
 * adapter's `resolveLabelId` to the shared `_shared/label-id-resolver`.
 * See the companion src/router/platformClients/linear.ts and
 * src/pm/linear/adapter.ts edits.
 */

import { linearClient, withLinearCredentials } from '../../../linear/client.js';
import { parseContainerId, parseLabelId, parseStateId } from '../../../pm/ids.js';
import { LinearIntegration } from '../../../pm/linear/integration.js';
import type {
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
} from '../../../pm/types.js';
import { LinearRouterAdapter } from '../../../router/adapters/linear.js';
import { LinearPlatformClient } from '../../../router/platformClients/linear.js';
import { LinearCommentMentionTrigger } from '../../../triggers/linear/comment-mention.js';
import { LinearReadyToProcessLabelTrigger } from '../../../triggers/linear/label-added.js';
import { LinearStatusChangedTrigger } from '../../../triggers/linear/status-changed.js';
import { makeHmacSha256Verifier } from '../_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../manifest.js';
import { linearConfigSchema } from './config-schema.js';

/**
 * Map Linear workflow-state type strings to CASCADE-canonical categories.
 * Linear's types: triage | backlog | unstarted | started | completed |
 * canceled. We collapse triage+backlog+unstarted → todo, started →
 * in_progress, completed → done, canceled → canceled, anything else →
 * unknown.
 */
function classifyLinearStateType(
	type: string,
): 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown' {
	switch (type) {
		case 'triage':
		case 'backlog':
		case 'unstarted':
			return 'todo';
		case 'started':
			return 'in_progress';
		case 'completed':
			return 'done';
		case 'canceled':
			return 'canceled';
		default:
			return 'unknown';
	}
}

const linearIntegration = new LinearIntegration();

export const linearManifest: PMProviderManifest = {
	id: 'linear',
	label: 'Linear',
	category: 'pm',

	credentialRoles: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'LINEAR_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: '/linear/webhook',
	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'linear-signature',
	}),

	routerAdapter: new LinearRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'linear') return null;
		return d.projectId ?? null;
	},

	pmIntegration: linearIntegration,

	triggerHandlers: [
		new LinearCommentMentionTrigger(),
		new LinearStatusChangedTrigger(),
		new LinearReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new LinearPlatformClient(projectId),

	// ── Plan 010/1 mutation hooks ──────────────────────────────────────
	// Linear exposes label creation through its GraphQL mutation
	// `issueLabelCreate`. Linear custom fields aren't exposed through the
	// CASCADE Linear client, so `createCustomField` stays unimplemented.
	createLabel: async ({ credentials, containerId, name, color }) => {
		const apiKey = credentials.api_key ?? '';
		return withLinearCredentials({ apiKey }, () =>
			linearClient.createLabel(containerId, name, color),
		);
	},

	// ── Plan 009/4 behavioral contract fields ─────────────────────────
	lifecycle: { enabled: true, fixtureKey: 'linear' },

	wizardSpec: {
		steps: [
			{ kind: 'credentials', id: 'linear-credentials' },
			{ kind: 'container-pick', id: 'linear-team' },
			{ kind: 'status-mapping', id: 'linear-statuses' },
			{ kind: 'label-mapping', id: 'linear-labels' },
			{ kind: 'project-scope', id: 'linear-project-scope' },
			{ kind: 'webhook-url-display', id: 'linear-webhook' },
		],
	},

	configSchema: linearConfigSchema,
	configFixture: {
		teamId: 'team-uuid-fixture',
		projectId: 'project-uuid-fixture',
		statuses: {
			backlog: 'state-backlog-fixture',
			todo: 'state-todo-fixture',
			inProgress: 'state-in-progress-fixture',
			done: 'state-done-fixture',
		},
		labels: {
			processing: 'label-processing-fixture',
			readyToProcess: 'label-ready-fixture',
		},
		customFields: { cost: 'cf-cost-fixture' },
	},

	/**
	 * Linear's discovery surface: teams (top-level), states (per-team
	 * workflow states), labels (per-team), and projects (per-team,
	 * optional scope narrowing from spec 005). `boards` isn't declared
	 * because Linear has no board concept; teams are the container.
	 */
	discoveryCapabilities: {
		teams: true,
		states: true,
		labels: true,
		projects: true,
	},

	/**
	 * Produce a discovery-scoped PMProvider. The factory binds credentials
	 * into Linear's AsyncLocalStorage scope via `withLinearCredentials`.
	 *
	 * Linear API keys are passed as the `Authorization` header directly
	 * (no `Bearer ` prefix — see #1112 / #1119). The factory wraps the
	 * singleton `linearClient` so no direct auth-header assembly lives
	 * here.
	 */
	createDiscoveryProvider: (opts) => {
		const creds = opts?.credentials ?? {};
		const apiKey = creds.api_key ?? '';

		const runWithCreds = <T>(fn: () => Promise<T>): Promise<T> =>
			withLinearCredentials({ apiKey }, fn);

		const provider: Pick<PMProvider, 'type' | 'discover'> = {
			type: 'linear',
			async discover<K extends DiscoveryCapability>(
				capability: K,
				args: DiscoveryArgs<K>,
			): Promise<DiscoveryResult<K>> {
				switch (capability) {
					case 'teams': {
						const teams = await runWithCreds(() => linearClient.getTeams());
						const out = teams.map((t) => ({
							id: parseContainerId(t.id),
							name: t.name,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'states': {
						const a = args as { containerId: string };
						const states = await runWithCreds(() =>
							linearClient.getTeamWorkflowStates(a.containerId),
						);
						const out = states.map((s) => ({
							id: parseStateId(s.id),
							name: s.name,
							category: classifyLinearStateType(s.type),
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'labels': {
						const a = args as { containerId: string };
						const labels = await runWithCreds(() => linearClient.getTeamLabels(a.containerId));
						const out = labels.map((l) => ({
							id: parseLabelId(l.id),
							name: l.name,
							color: l.color ?? undefined,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'projects': {
						const a = args as { containerId?: string };
						const containerId = a.containerId;
						if (!containerId) {
							// Linear projects scope inside a team. Without a
							// team context, return empty — the wizard picks
							// team first.
							return [] as unknown as DiscoveryResult<K>;
						}
						const projects = await runWithCreds(() => linearClient.getTeamProjects(containerId));
						const out = projects.map((p) => ({
							id: parseContainerId(p.id),
							name: p.name,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					default:
						throw new Error(
							`Linear provider does not support discovery capability '${capability}'`,
						);
				}
			},
		};

		return provider as PMProvider;
	},
};
