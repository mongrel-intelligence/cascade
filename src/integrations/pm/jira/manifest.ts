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
import { type JiraAuthType, jiraConfigSchema } from './config-schema.js';

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

/**
 * Narrow a raw `auth_type` value to the {@link JiraAuthType} union. Accepts
 * `unknown` so it can guard both the discovery credentials bag (a
 * `Record<string, string>`, where the value is a plain string or `undefined`)
 * and the persisted integration config (where `authType` is untyped JSON).
 * Anything other than the two recognized modes returns `undefined`, which the
 * JIRA client + host resolver (`resolveJiraApiBaseUrl`) treat as `'basic'` —
 * the historical default. This keeps unknown / absent values from ever
 * selecting the scoped gateway host.
 */
function coerceJiraAuthType(value: unknown): JiraAuthType | undefined {
	return value === 'basic' || value === 'scoped' ? value : undefined;
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
		// Carry the configured auth mode so the JIRA client routes the
		// createCustomField call through the correct host (site vs. scoped
		// gateway). Absent ⇒ downstream treats it as 'basic'.
		const authType = coerceJiraAuthType(credentials.auth_type);
		return withJiraCredentials({ email, apiToken, baseUrl, authType }, async () => {
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
			// Spec 024 plan 5: the discriminator that decides which of several
			// projects sharing this JIRA key owns an issue. Optional and empty by
			// default — a project that does not share a board never touches it.
			// Custom rather than a StandardStepKind because JIRA is the only
			// provider with shared-key routing today.
			{ kind: 'custom', id: 'jira-routing', component: 'RoutingStep' },
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

	/**
	 * JIRA's cloud tenant URL and auth mode are non-secret connection fields
	 * stored on `project_integrations.config` (`baseUrl` / `authType`), not
	 * `project_credentials`. The pm-discovery resolver invokes this hook on the
	 * projectId path to promote them into the credentials bag the
	 * `createDiscoveryProvider` factory below consumes. Without `base_url`,
	 * edit-mode re-verification in the wizard constructs
	 * `new Version3Client({ host: '' })` and throws "Couldn't parse the host
	 * URL" (prod incident 2026-04-24). Without `auth_type`, scoped projects
	 * re-verify against the classic site host instead of the Atlassian gateway
	 * (MNG-1743).
	 */
	configToCredentials: (config: unknown): Record<string, string> => {
		if (!config || typeof config !== 'object') return {};
		const promoted: Record<string, string> = {};
		const baseUrl = (config as { baseUrl?: unknown }).baseUrl;
		if (typeof baseUrl === 'string' && baseUrl.length > 0) {
			promoted.base_url = baseUrl;
		}
		const authType = coerceJiraAuthType((config as { authType?: unknown }).authType);
		if (authType) {
			promoted.auth_type = authType;
		}
		return promoted;
	},

	configSchema: jiraConfigSchema,
	configFixture: {
		projectKey: 'CASCADE',
		baseUrl: 'https://example.atlassian.net',
		authType: 'basic',
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
		// Carry the configured auth mode so wizard-time / edit-mode discovery
		// (currentUser / projects / states / customFields) routes through the
		// correct host — the classic site URL for basic, the Atlassian gateway
		// for scoped. `configToCredentials` promotes `config.authType` into
		// `auth_type` on the projectId (edit-mode) path; the raw-creds
		// (first-time setup) path receives it straight from the wizard.
		const authType = coerceJiraAuthType(creds.auth_type);

		const runWithCreds = <T>(fn: () => Promise<T>): Promise<T> =>
			withJiraCredentials({ email, apiToken, baseUrl, authType }, fn);

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
