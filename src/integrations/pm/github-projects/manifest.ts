/**
 * GitHub Projects PM provider manifest.
 *
 * Wires GitHub Projects (Projects v2) into the CASCADE PM provider system.
 * Uses GitHub GraphQL API for queries/mutations and GitHub webhook events
 * for triggers.
 */

import {
	getOrganizationProjects,
	getStatusField,
	getUserProjects,
	getViewer,
	withGitHubProjectsCredentials,
} from '../../../github-projects/client.js';
import { GitHubProjectsIntegration } from '../../../pm/github-projects/integration.js';
import { parseContainerId, parseStateId } from '../../../pm/ids.js';
import type {
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
} from '../../../pm/types.js';
import { GitHubProjectsRouterAdapter } from '../../../router/adapters/github-projects.js';
import { GitHubProjectsPlatformClient } from '../../../router/platformClients/github-projects.js';
import { GitHubProjectsStatusChangedTrigger } from '../../../triggers/github-projects/status-changed.js';
import { makeHmacSha256Verifier } from '../_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../manifest.js';
import { githubProjectsConfigSchema } from './config-schema.js';

/**
 * Map GitHub Projects status option name to CASCADE-canonical category.
 */
function classifyGitHubStatus(
	name: string,
): 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown' {
	const n = name.toLowerCase();
	if (n === 'todo' || n === 'backlog' || n === 'to do' || n === 'no status') return 'todo';
	if (n === 'in progress' || n === 'in review' || n === 'doing' || n === 'review')
		return 'in_progress';
	if (n === 'done' || n === 'complete' || n === 'completed') return 'done';
	if (n === 'canceled' || n === 'cancelled') return 'canceled';
	return 'unknown';
}

// ============================================================================
// Discovery handlers
// ============================================================================

/**
 * Discover projects for a given owner (user or organization).
 * The containerId is expected to be in the format "login:ownerType".
 */
async function handleProjectsDiscovery(
	args: DiscoveryArgs<'projects'>,
	runWithCreds: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<DiscoveryResult<'projects'>> {
	const a = args as { containerId?: string };
	const owner = a.containerId;
	if (!owner) return [];

	const [login, ownerType] = owner.split(':');
	const projects =
		ownerType === 'organization'
			? await runWithCreds(() => getOrganizationProjects(login))
			: await runWithCreds(() => getUserProjects(login));

	return projects.map((p) => ({
		id: parseContainerId(p.id),
		name: p.title,
		url: p.url,
	}));
}

/**
 * Discover states (Status field options) for a project.
 * The containerId should be the project node ID.
 */
async function handleStatesDiscovery(
	args: DiscoveryArgs<'states'>,
	runWithCreds: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<DiscoveryResult<'states'>> {
	const a = args as { containerId: string };
	const statusField = await runWithCreds(() => getStatusField(a.containerId));
	if (!statusField) return [];

	return statusField.options.map((o) => ({
		id: parseStateId(o.id),
		name: o.name,
		category: classifyGitHubStatus(o.name),
	}));
}

/**
 * Discover the current authenticated user.
 */
async function handleCurrentUserDiscovery(
	_args: DiscoveryArgs<'currentUser'>,
	runWithCreds: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<DiscoveryResult<'currentUser'>> {
	const me = await runWithCreds(() => getViewer());
	return {
		id: me.id,
		name: me.name ?? me.login,
		displayName: me.name ?? me.login,
	};
}

const githubProjectsIntegration = new GitHubProjectsIntegration();

export const githubProjectsManifest: PMProviderManifest = {
	id: 'github-projects',
	label: 'GitHub Projects',
	category: 'pm',

	credentialRoles: [
		{
			role: 'token',
			label: 'Personal Access Token',
			envVarKey: 'GITHUB_TOKEN',
		},
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'GITHUB_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: '/github-projects/webhook',
	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'x-hub-signature-256',
		headerPrefix: 'sha256=',
	}),

	routerAdapter: new GitHubProjectsRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'github-projects') return null;
		return d.projectId ?? null;
	},

	pmIntegration: githubProjectsIntegration,

	triggerHandlers: [new GitHubProjectsStatusChangedTrigger()],

	platformClientFactory: (projectId) => new GitHubProjectsPlatformClient(projectId),

	// Discovery capabilities for wizard. `states` powers the status-mapping step
	// (the wizard queries capability 'states' to list the project's Status
	// options); it MUST be declared or the generic pm.discovery endpoint rejects
	// the call and the provider cannot be configured.
	discoveryCapabilities: {
		projects: true,
		states: true,
		currentUser: true,
	},

	wizardSpec: {
		steps: [
			{ kind: 'credentials', id: 'github-projects-credentials' },
			{ kind: 'project-scope', id: 'github-projects-scope' },
			{ kind: 'container-pick', id: 'github-projects-selection' },
			{ kind: 'status-mapping', id: 'github-projects-statuses' },
			{ kind: 'webhook-url-display', id: 'github-projects-webhook' },
		],
	},

	// Opt into the behavioral conformance harness's full lifecycle scenario,
	// giving github-projects parity with Trello/JIRA/Linear. The fixture keyed
	// by 'github-projects' lives in the test-only LIFECYCLE_FIXTURES registry.
	lifecycle: { enabled: true, fixtureKey: 'github-projects' },

	configSchema: githubProjectsConfigSchema,
	configFixture: {
		projectId: 'PVT_xxx',
		owner: 'username',
		ownerType: 'user',
		// Status *option* IDs are short opaque hashes, not the `PVTSSF_…` field ID.
		statuses: {
			todo: '47fc9ee4',
			inProgress: '98236657',
			done: 'f75ad846',
		},
	},

	createDiscoveryProvider: (opts) => {
		const token = opts?.credentials?.token ?? '';

		const runWithCreds = <T>(fn: () => Promise<T>): Promise<T> =>
			withGitHubProjectsCredentials({ token }, fn);

		const provider: Pick<PMProvider, 'type' | 'discover'> = {
			type: 'github-projects',
			async discover<K extends DiscoveryCapability>(
				capability: K,
				args: DiscoveryArgs<K>,
			): Promise<DiscoveryResult<K>> {
				switch (capability) {
					case 'projects':
						return (await handleProjectsDiscovery(
							args as DiscoveryArgs<'projects'>,
							runWithCreds,
						)) as DiscoveryResult<K>;
					case 'states':
						return (await handleStatesDiscovery(
							args as DiscoveryArgs<'states'>,
							runWithCreds,
						)) as DiscoveryResult<K>;
					case 'currentUser':
						return (await handleCurrentUserDiscovery(
							args as DiscoveryArgs<'currentUser'>,
							runWithCreds,
						)) as DiscoveryResult<K>;
					default:
						throw new Error(
							`GitHub Projects provider does not support discovery capability '${capability}'`,
						);
				}
			},
		};

		return provider as PMProvider;
	},
};
