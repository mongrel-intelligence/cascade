/**
 * PMProviderManifest — the single declarative contract for a PM provider.
 *
 * Historically, adding a PM provider required edits in ~10 cross-cutting
 * locations (router routes, adapter registry, trigger registry, credential
 * roles, job-dispatch extractor, wizard state union, wizard hooks, wizard
 * router, tRPC discovery endpoints). The Linear rollout surfaced this as
 * four separate silent bugs in production. A manifest collapses every
 * registration into one object per provider; a conformance harness
 * (tests/unit/integrations/pm-conformance.test.ts) asserts the contract
 * is fully implemented at CI time.
 *
 * A provider author writes ONE module that exports a `PMProviderManifest`
 * and side-effectfully calls `registerPMProvider(manifest)` at load time.
 * Nothing else in the codebase knows about that provider's existence.
 *
 * Frontend wizard definitions live in a parallel registry keyed by the
 * same `id` — see web/src/components/projects/pm-providers/.
 */

import type { z } from 'zod';
import type { PMIntegration } from '../../pm/integration.js';
import type { ParsedWebhookEvent, RouterPlatformAdapter } from '../../router/platform-adapter.js';
import type { PlatformCommentClient } from '../../router/platformClients/types.js';
import type { CascadeJob } from '../../router/queue.js';
import type { TriggerHandler } from '../../types/index.js';

// ParsedWebhookEvent is referenced transitively by RouterPlatformAdapter and
// isSelfAuthoredHook; re-exported so callers that want to type their hooks
// don't need to know the internal path.
export type { ParsedWebhookEvent };

/**
 * One credential the provider needs resolved at runtime. Mirrors the shape
 * already in use by `registerCredentialRoles()` in `src/config/integrationRoles.ts`.
 */
export interface CredentialRoleSpec {
	readonly role: string;
	readonly label: string;
	readonly envVarKey: string;
	/** When `true`, the role is not required for `hasIntegration()` to return true. */
	readonly optional?: boolean;
}

/**
 * A verifier asserts the webhook payload came from the provider. Returns
 * `true` when the request is authentic. Called with the raw body text (for
 * HMAC computation) and the parsed headers. `secret` is `null` when the
 * project has opted out of HMAC verification.
 */
export type WebhookVerifier = (
	rawBody: string,
	headers: Record<string, string | undefined>,
	secret: string | null,
) => boolean;

/**
 * Produces a platform client scoped to a project. The client posts
 * acknowledgment comments during router-side webhook handling; it is
 * distinct from the PMProvider used by agents (the adapter).
 */
export type PlatformClientFactory = (projectId: string) => PlatformCommentClient;

// ── Plan 009/1 additions: behavioral contract fields ────────────────────
//
// Three optional fields (plus a lifecycle opt-in) let a provider declare
// contracts the conformance harness then validates:
//   - `configSchema` — a Zod schema for the persisted integration config.
//     Eliminates the two-layer schema-drift class of bug that shipped
//     `projectId` stripped twice (#1138 + #1142).
//   - `discoveryCapabilities` — which discovery queries the adapter can
//     serve. Consumed by the generic `pm.discover` tRPC endpoint.
//   - `wizardSpec` — a declarative list of standard wizard steps the
//     shared generator renders. Stops every provider from re-implementing
//     the same credentials / container-pick / status-mapping UI.
//   - `lifecycle` — opt-in flag + fixture for the full-lifecycle scenario
//     the behavioral conformance harness runs against the adapter.

/** The discovery capabilities a provider may declare support for. */
export interface DiscoveryCapabilitiesMap {
	readonly teams?: true;
	readonly boards?: true;
	readonly labels?: true;
	readonly states?: true;
	readonly projects?: true;
	readonly customFields?: true;
	readonly containers?: true;
	/** Plan 010/2: restores "Verified as @username" wizard UX via generic dispatch. */
	readonly currentUser?: true;
}

/** Every wizard step kind the generic generator knows how to render. */
export type StandardStepKind =
	| 'credentials'
	| 'container-pick'
	| 'status-mapping'
	| 'label-mapping'
	| 'webhook-url-display'
	| 'project-scope'
	| 'custom-field-mapping';

export interface StandardStep {
	readonly kind: StandardStepKind;
	readonly id: string;
	readonly config?: Readonly<Record<string, unknown>>;
}

export interface CustomStep {
	readonly kind: 'custom';
	readonly id: string;
	/** Name of a provider-folder-owned component. The wizard shell resolves it through the providerWizardRegistry. */
	readonly component: string;
	readonly config?: Readonly<Record<string, unknown>>;
}

export interface WizardSpec {
	readonly steps: ReadonlyArray<StandardStep | CustomStep>;
}

/** Lifecycle opt-in for the behavioral conformance harness. */
export interface LifecycleOptIn {
	readonly enabled: true;
	/**
	 * Opaque string key the test harness uses to look up the provider's
	 * lifecycle fixture in a test-only registry. Fixtures live under
	 * `tests/helpers/` and can't be imported from production code, so
	 * the manifest references them by key. When omitted, the harness
	 * falls back to the generic fake provider.
	 */
	readonly fixtureKey?: string;
}

export interface PMProviderManifest {
	// ── Identity ────────────────────────────────────────────────────────
	readonly id: string;
	readonly label: string;
	readonly category: 'pm';

	// ── Credentials ─────────────────────────────────────────────────────
	readonly credentialRoles: readonly CredentialRoleSpec[];

	// ── Webhook ingestion ───────────────────────────────────────────────
	/**
	 * Conventionally `/${id}/webhook`. Enforced by the conformance harness.
	 * Operators manually configure this URL in each provider's UI.
	 */
	readonly webhookRoute: string;
	readonly verifyWebhookSignature: WebhookVerifier;

	// ── Router-side dispatch ────────────────────────────────────────────
	/**
	 * Includes `parseWebhook(raw)` which yields a ParsedWebhookEvent for
	 * router-side project resolution and trigger dispatch. Provider-domain
	 * parsing (PMWebhookEvent) lives on `pmIntegration.parseWebhookPayload`.
	 */
	readonly routerAdapter: RouterPlatformAdapter;

	/**
	 * Extract the CASCADE projectId from a job payload produced by this
	 * provider's router adapter. Returns `null` when the job belongs to a
	 * different provider. Forgetting to implement this case was the root
	 * cause of Linear workers spawning without credentials (see #1118).
	 */
	readonly extractProjectIdFromJob: (jobData: CascadeJob) => Promise<string | null>;

	// ── PM operations (agent-facing) ────────────────────────────────────
	readonly pmIntegration: PMIntegration;

	// ── Triggers ────────────────────────────────────────────────────────
	readonly triggerHandlers: readonly TriggerHandler[];

	// ── Router-side platform client (ack comments) ──────────────────────
	readonly platformClientFactory: PlatformClientFactory;

	// ── Optional provider-specific hooks ────────────────────────────────

	/**
	 * Returns `true` when the event was authored by the bot itself.
	 * Optional — providers without self-authored webhook events can omit.
	 * When omitted, `false` is assumed.
	 */
	readonly isSelfAuthoredHook?: (
		event: ParsedWebhookEvent,
		payload: unknown,
		projectId: string,
	) => Promise<boolean>;

	/**
	 * Create a single label on the provider (e.g. Trello board, Linear team).
	 * Manifests that support wizard-driven label creation implement this hook;
	 * others omit it and the generic `pm.discovery.createLabel` tRPC endpoint
	 * returns a 404 for that provider.
	 */
	readonly createLabel?: (opts: {
		credentials: Record<string, string>;
		containerId: string;
		name: string;
		color?: string;
	}) => Promise<{ id: string; name: string; color: string }>;

	/**
	 * Create a single custom field on the provider (e.g. Trello board,
	 * JIRA tenant). Plan 010/1 adds this hook as a sibling of `createLabel`.
	 * Manifests that support wizard-driven custom-field creation implement it;
	 * others omit it and `pm.discovery.createCustomField` returns
	 * NOT_IMPLEMENTED for that provider.
	 *
	 * Uses the same options-bag shape as `createLabel`. `credentials` is the
	 * shape declared by the manifest's `credentialRoles`; the hook is
	 * responsible for establishing its own credential scope (typically via
	 * the provider's `withXxxCredentials` AsyncLocalStorage helper).
	 *
	 * `containerId` is the provider-native scope (Trello board, JIRA project
	 * key, Linear team). JIRA custom fields are global — the hook accepts
	 * `containerId` for uniform shape but may ignore it internally.
	 */
	readonly createCustomField?: (opts: {
		credentials: Record<string, string>;
		containerId: string;
		name: string;
	}) => Promise<{ id: string; name: string; type: string }>;

	// ── Plan 009/1 additions ─────────────────────────────────────────────

	/**
	 * Zod schema for the provider's persisted integration config.
	 *
	 * When declared, the conformance harness asserts round-trip identity:
	 * a fixture config parsed → serialized → reparsed yields a deep-equal
	 * config. This eliminates the two-layer drift that shipped `projectId`
	 * stripped twice in Linear (#1138 + #1142).
	 *
	 * Plans 2/3/4 move each real provider's schema from `src/config/schema.ts`
	 * onto its manifest here. `configMapper` routes through the registry
	 * in plan 5.
	 */
	readonly configSchema?: z.ZodType<unknown>;

	/**
	 * Optional sample config used by the conformance harness round-trip
	 * asserter. Must be parseable by `configSchema`. If absent, the harness
	 * falls back to the schema's default parse (may error — prefer to
	 * declare a fixture alongside the schema).
	 */
	readonly configFixture?: unknown;

	/**
	 * The set of discovery capabilities this provider supports. Consumed
	 * by the generic `pm.discover` tRPC endpoint. An adapter that declares
	 * a capability here MUST implement the corresponding `discover(k, args)`
	 * method on the agent-facing PM adapter.
	 */
	readonly discoveryCapabilities?: DiscoveryCapabilitiesMap;

	/**
	 * Declarative wizard step spec consumed by the shared wizard generator.
	 * Every step whose `kind` is a `StandardStepKind` is rendered by the
	 * generator from a shared component; `kind: 'custom'` steps are
	 * resolved through the provider-owned wizard folder.
	 */
	readonly wizardSpec?: WizardSpec;

	/**
	 * Opt-in flag + fixture for the behavioral conformance harness's
	 * lifecycle scenario (create → list → move → checklist → comment →
	 * delete). Legacy providers keep `lifecycle` undefined — harness skips
	 * them. The fake PM provider and any migrated real provider set
	 * `lifecycle.enabled: true` and provide a fixture.
	 */
	readonly lifecycle?: LifecycleOptIn;

	/**
	 * Optional factory for producing a PM adapter instance outside of a
	 * project context — used by the generic `pm.discover` tRPC endpoint
	 * during wizard setup, when the user hasn't saved a project yet so
	 * `pmIntegration.createProvider(project)` isn't applicable.
	 *
	 * Accepts raw credentials in the same shape the wizard collects; adapters
	 * may ignore the argument when discovery doesn't need credentials (e.g.
	 * the fake provider). Plans 2/3/4 wire each real provider's factory.
	 */
	readonly createDiscoveryProvider?: (opts?: {
		credentials?: Record<string, string>;
	}) => import('../../pm/types.js').PMProvider;
}

/**
 * Asserts a manifest's declared `configSchema` accepts its `configFixture`.
 *
 * When both are declared, the harness calls this at CI time — a manifest
 * author can also invoke it at module load for immediate feedback. The
 * function is a no-op when `configSchema` is undefined (legacy providers
 * that haven't migrated yet).
 */
export function validateManifestAgainstSchema(manifest: PMProviderManifest): void {
	if (!manifest.configSchema) return;
	if (manifest.configFixture === undefined) {
		// No fixture to validate against — harness's round-trip step still
		// runs with a schema-synthesized sample, so this is non-fatal.
		return;
	}
	// Throws ZodError if the fixture doesn't parse.
	manifest.configSchema.parse(manifest.configFixture);
}
