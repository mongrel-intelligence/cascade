/**
 * Frontend PM provider wizard definition.
 *
 * This is the UI-side half of the provider manifest pattern. The backend
 * `PMProviderManifest` (see `src/integrations/pm/manifest.ts`) owns
 * everything React cannot see — router adapters, trigger handlers,
 * server-side API clients. This file owns everything the dashboard wizard
 * needs — step components, completion predicates, and the save transform.
 *
 * Frontend and backend registries are **coupled only by the `id` string**.
 * The conformance harness asserts that every backend manifest has a
 * matching frontend wizard when real providers migrate onto them.
 */

import type React from 'react';
import type { WizardAction, WizardState } from '../pm-wizard-state.js';

export interface ProviderWizardStep {
	/** Stable identifier for the step. Used for keys + debugging. */
	readonly id: string;
	/** Human-readable title rendered in the wizard header. */
	readonly title: string;
	/** React component that renders the step body. */
	readonly Component: React.ComponentType<ProviderWizardStepProps>;
	/** Predicate that returns true when this step's inputs are valid. */
	readonly isComplete: (state: WizardState) => boolean;
}

/**
 * Standard props every step component receives. Provider-specific hooks
 * (e.g. Trello's `onCreateLabel`, Linear's `linearDetailsMutation`) can be
 * passed through via the props spread in the parent wizard.
 */
export interface ProviderWizardStepProps {
	readonly state: WizardState;
	readonly dispatch: React.Dispatch<WizardAction>;
	// Providers requiring extra handlers (label creation, OAuth popups, etc.)
	// receive them via an extension object. The parent wizard owns instantiation.
	readonly providerHooks?: Record<string, unknown>;
}

/**
 * Context passed to `useProviderHooks`. The generic wizard renderer
 * owns these values; provider hooks can consume them to compose
 * provider-specific discovery / label-creation hooks.
 */
export interface ProviderHooksContext {
	readonly providerId: string;
	readonly auth: ProviderAuthMetadata;
	readonly state: WizardState;
	readonly dispatch: React.Dispatch<WizardAction>;
	readonly projectId: string | undefined;
	readonly advanceToStep: (step: number) => void;
}

export interface ProviderAuthCredentialMapping {
	/** Provider API credential key sent to discovery endpoints. */
	readonly role: string;
	/** Wizard state field containing the raw credential/config value. */
	readonly stateField: keyof WizardState;
	/** Overrides the provider-level missing-credential message for this field. */
	readonly missingMessage?: string;
}

export interface ProviderStoredCredentialAuth {
	/**
	 * In edit mode, an empty raw credential field means "use credentials already
	 * saved on this project" and sends `{ projectId }` instead of raw secrets.
	 */
	readonly fallbackWhenStateFieldEmpty: keyof WizardState;
}

export interface ProviderAuthMetadata {
	/** Raw credential payload shape for verification/discovery calls. */
	readonly rawCredentials: readonly ProviderAuthCredentialMapping[];
	/** Stored-project-credential fallback shape for edit mode. */
	readonly storedCredentials: ProviderStoredCredentialAuth;
	/** Default error when required raw credentials are missing. */
	readonly missingCredentialsMessage: string;
}

export interface ProviderCredentialPersistenceMapping {
	/** Environment variable key persisted to project_credentials. */
	readonly envVarKey: string;
	/** Wizard state field containing the value to persist. */
	readonly stateField: keyof WizardState;
	/** Human-readable name stored with the credential. */
	readonly label: string;
}

export interface ProviderWizardDefinition {
	/** Must match the backend manifest id (e.g. 'trello', 'linear'). */
	readonly id: string;
	/** Human-readable label shown in the provider-select dropdown. */
	readonly label: string;
	/** Ordered list of wizard steps. */
	readonly steps: readonly ProviderWizardStep[];
	/** Provider-owned auth contract for raw credentials and stored fallback. */
	readonly auth: ProviderAuthMetadata;
	/** Formats the provider's normalized current-user discovery response. */
	readonly formatVerificationDisplay: (me: {
		readonly id: string;
		readonly name: string;
		readonly displayName?: string;
	}) => string;
	/** Normal provider credentials saved to project_credentials. */
	readonly credentialPersistence: readonly ProviderCredentialPersistenceMapping[];
	/**
	 * Transforms wizard state into the integration config payload sent to the
	 * save API. Mirrors the existing `buildXxxIntegrationConfig` functions.
	 */
	readonly buildIntegrationConfig: (state: WizardState) => Record<string, unknown>;
	/**
	 * Hydrates provider-owned edit-mode wizard state from a saved integration
	 * config plus the project credential keys currently configured on the server.
	 * Raw credential values must not be returned.
	 */
	readonly buildEditState: (
		initialConfig: Record<string, unknown>,
		configuredKeys: ReadonlySet<string>,
	) => Partial<WizardState>;
	/** True when all required steps report complete. */
	readonly isSetupComplete: (state: WizardState) => boolean;
	/**
	 * Optional React hook that composes provider-specific discovery / label /
	 * custom-field mutations. The generic wizard calls this once from the
	 * provider-keyed manifest-step wrapper and shares the result with every
	 * step, so providers do not create one hook instance per step.
	 *
	 * The return value is passed to every step's `Component` via the
	 * `providerHooks` prop. Each step component adapts the shape it needs.
	 */
	readonly useProviderHooks?: (ctx: ProviderHooksContext) => Record<string, unknown>;
}
