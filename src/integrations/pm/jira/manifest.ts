/**
 * JIRA PM provider manifest.
 *
 * Wires the existing JIRA implementation (JiraIntegration, JiraRouterAdapter,
 * JIRA triggers, JiraPlatformClient) into the PMProviderManifest contract.
 *
 * Signing: JIRA uses `HMAC-SHA256(body)` with `sha256=<hex>` in the
 * `X-Hub-Signature` header. This maps onto the shared
 * `makeHmacSha256Verifier` factory landed in plan 006/1.
 *
 * Labels: JIRA labels are free-form names — the JIRA API auto-creates
 * them on use. The shared `label-id-resolver` helper is NOT wired here;
 * it's UUID-only. No `createLabel` manifest hook either for the same
 * reason.
 */

import { jiraClient, withJiraCredentials } from '../../../jira/client.js';
import { parseContainerId, parseStateId } from '../../../pm/ids.js';
import { JiraIntegration } from '../../../pm/jira/integration.js';
import type {
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
} from '../../../pm/types.js';
import { JiraRouterAdapter } from '../../../router/adapters/jira.js';
import { JiraPlatformClient } from '../../../router/platformClients/jira.js';
import { JiraCommentMentionTrigger } from '../../../triggers/jira/comment-mention.js';
import { JiraReadyToProcessLabelTrigger } from '../../../triggers/jira/label-added.js';
import { JiraStatusChangedTrigger } from '../../../triggers/jira/status-changed.js';
import { makeHmacSha256Verifier } from '../_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../manifest.js';
import { jiraConfigSchema } from './config-schema.js';

/**
 * Coerce a JIRA status name to a CASCADE-canonical category. JIRA
 * doesn't expose category IDs via the per-project status endpoint we
 * use — so we classify by common name patterns. A richer mapping would
 * pull `statusCategory.key` from the full issue-type scheme endpoint,
 * which isn't worth the cost for plan 3 scope.
 */
function classifyJiraStatus(
	name: string,
): 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown' {
	const n = name.toLowerCase();
	if (n === 'done' || n === 'closed' || n === 'resolved') return 'done';
	if (n === 'canceled' || n === 'cancelled') return 'canceled';
	if (n === 'to do' || n === 'todo' || n === 'open' || n === 'backlog') return 'todo';
	if (n === 'in progress' || n === 'in review' || n === 'in testing') return 'in_progress';
	return 'unknown';
}

const jiraIntegration = new JiraIntegration();

export const jiraManifest: PMProviderManifest = {
	id: 'jira',
	label: 'JIRA',
	category: 'pm',

	credentialRoles: [
		{ role: 'email', label: 'Email', envVarKey: 'JIRA_EMAIL' },
		{ role: 'api_token', label: 'API Token', envVarKey: 'JIRA_API_TOKEN' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'JIRA_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: '/jira/webhook',
	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'x-hub-signature',
		headerPrefix: 'sha256=',
	}),

	routerAdapter: new JiraRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'jira') return null;
		return d.projectId ?? null;
	},

	pmIntegration: jiraIntegration,

	triggerHandlers: [
		new JiraCommentMentionTrigger(),
		new JiraStatusChangedTrigger(),
		new JiraReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new JiraPlatformClient(projectId),

	// ── Plan 010/1 mutation hooks ──────────────────────────────────────
	// JIRA custom fields are global (not per-project). The hook accepts
	// containerId for uniform shape but doesn't thread it to the client.
	// Default type: 'com.atlassian.jira.plugin.system.customfieldtypes:float'
	// matches CASCADE's cost-tracking use case.
	createCustomField: async ({ credentials, name }) => {
		const email = credentials.email ?? '';
		const apiToken = credentials.api_token ?? '';
		const baseUrl = credentials.base_url ?? '';
		return withJiraCredentials({ email, apiToken, baseUrl }, async () => {
			const result = await jiraClient.createCustomField(
				name,
				'com.atlassian.jira.plugin.system.customfieldtypes:float',
			);
			return {
				id: result.id,
				name: result.name,
				type: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
			};
		});
	},

	// ── Plan 009/3 behavioral contract fields ─────────────────────────
	lifecycle: { enabled: true, fixtureKey: 'jira' },

	wizardSpec: {
		steps: [
			{ kind: 'credentials', id: 'jira-credentials' },
			{ kind: 'container-pick', id: 'jira-project' },
			{ kind: 'status-mapping', id: 'jira-statuses' },
			{ kind: 'label-mapping', id: 'jira-labels' },
			{ kind: 'custom-field-mapping', id: 'jira-custom-fields' },
			// Plan 011/3: JIRA task/subtask issue-type mapping is JIRA-specific
			// (Trello has no equivalent, Linear uses workflow states). Rendered
			// as a `kind: 'custom'` step resolved to `IssueTypeMappingStep` by
			// the JIRA ProviderWizardDefinition.
			{ kind: 'custom', id: 'jira-issue-types', component: 'IssueTypeMappingStep' },
			{ kind: 'webhook-url-display', id: 'jira-webhook' },
		],
	},

	configSchema: jiraConfigSchema,
	configFixture: {
		projectKey: 'CASCADE',
		baseUrl: 'https://example.atlassian.net',
		statuses: { backlog: 'Backlog', todo: 'To Do', done: 'Done' },
		issueTypes: { task: 'Task' },
		customFields: { cost: 'customfield_10100' },
		labels: {
			processing: 'cascade-processing',
			processed: 'cascade-processed',
			error: 'cascade-error',
			readyToProcess: 'cascade-ready',
		},
	},

	/**
	 * JIRA's discovery surface: projects (container-level), states
	 * (per-project workflow statuses), labels (always empty — JIRA
	 * labels are free-form strings, not a curated enumeration), and
	 * custom fields. `boards` isn't declared because CASCADE's JIRA
	 * integration operates at the project level, not the agile-board
	 * level.
	 */
	discoveryCapabilities: {
		projects: true,
		states: true,
		labels: true,
		customFields: true,
		currentUser: true,
	},

	/**
	 * Produce a discovery-scoped PMProvider. The factory binds the
	 * provided credentials into JIRA's AsyncLocalStorage scope via
	 * `withJiraCredentials`, so the singleton jiraClient doesn't need
	 * per-call credential threading.
	 *
	 * `credentials` is shaped per credentialRoles + a synthetic `base_url`
	 * slot the wizard passes during setup (before the config is saved).
	 */
	createDiscoveryProvider: (opts) => {
		const creds = opts?.credentials ?? {};
		const email = creds.email ?? '';
		const apiToken = creds.api_token ?? '';
		const baseUrl = creds.base_url ?? '';

		const runWithCreds = <T>(fn: () => Promise<T>): Promise<T> =>
			withJiraCredentials({ email, apiToken, baseUrl }, fn);

		const provider: Pick<PMProvider, 'type' | 'discover'> = {
			type: 'jira',
			async discover<K extends DiscoveryCapability>(
				capability: K,
				args: DiscoveryArgs<K>,
			): Promise<DiscoveryResult<K>> {
				switch (capability) {
					case 'projects': {
						const projects = await runWithCreds(() => jiraClient.searchProjects());
						const out = projects.map((p) => ({
							id: parseContainerId(p.key),
							name: p.name,
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'states': {
						const a = args as { containerId: string };
						const statuses = await runWithCreds(() => jiraClient.getProjectStatuses(a.containerId));
						const out = statuses.map((s) => ({
							id: parseStateId(s.id),
							name: s.name,
							category: classifyJiraStatus(s.name),
						}));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'labels': {
						// JIRA labels are free-form strings, created on first
						// write. No canonical per-project "list labels"
						// endpoint — return empty and let the wizard's
						// label-mapping UI accept free text for JIRA.
						return [] as unknown as DiscoveryResult<K>;
					}
					case 'customFields': {
						const fields = await runWithCreds(() => jiraClient.getFields());
						// Filter to custom fields only — JIRA returns all
						// built-in fields (summary, description, etc.) from
						// the same endpoint, which would clutter the wizard.
						const out = fields
							.filter((f) => f.custom)
							.map((f) => ({ id: f.id, name: f.name, type: 'custom' }));
						return out as unknown as DiscoveryResult<K>;
					}
					case 'currentUser': {
						// Plan 010/2: restore verification UX. Use the JIRA
						// account's displayName as the primary name and the
						// email as secondary (matches the pre-009/5 display).
						const me = (await runWithCreds(() => jiraClient.getMyself())) as {
							accountId?: string;
							displayName?: string;
							emailAddress?: string;
						};
						const out = {
							id: me.accountId ?? '',
							name: me.displayName ?? '',
							displayName: me.emailAddress,
						};
						return out as unknown as DiscoveryResult<K>;
					}
					default:
						throw new Error(`JIRA provider does not support discovery capability '${capability}'`);
				}
			},
		};

		return provider as PMProvider;
	},
};
