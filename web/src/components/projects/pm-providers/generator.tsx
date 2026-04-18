/**
 * Wizard step generator (plan 010/3 — upgraded from placeholders).
 *
 * Provides `renderStandardStep(step, ctx)` — a switch over
 * `StandardStep['kind']` that returns the real shared component for
 * each standard kind. Per-provider caller code can use these components
 * directly by importing from `./steps/` and supplying the props each
 * component requires; `renderStandardStep` itself is the "minimal
 * dispatcher" path that new providers use to short-circuit writing
 * custom step UI.
 *
 * For unknown `kind` values the generator logs a warn-once and returns
 * a visible placeholder — preserved from the plan 009/1 scaffolding so a
 * manifest declaring an unknown step kind doesn't crash the wizard.
 *
 * The existing Trello/JIRA/Linear wizards retain their per-provider
 * step files (`pm-wizard-<provider>-steps.tsx`); a follow-up plan can
 * migrate them to use these shared components.
 */

import type React from 'react';
import { createElement } from 'react';
import type {
	CustomStep,
	StandardStep,
	StandardStepKind,
} from '../../../../../src/integrations/pm/manifest.js';
import { ContainerPickStep } from './steps/container-pick.js';
import { CredentialsStep } from './steps/credentials.js';
import { LabelMappingStep } from './steps/label-mapping.js';
import { ProjectScopeStep } from './steps/project-scope.js';
import { StatusMappingStep } from './steps/status-mapping.js';
import { WebhookUrlDisplayStep } from './steps/webhook-url-display.js';

export interface WizardStepRenderContext {
	readonly providerId: string;
	readonly providerHooks?: Record<string, unknown>;
}

/**
 * Registry of shared step components keyed by `StandardStepKind`. Callers
 * that want direct access to a specific component (e.g. to supply provider-
 * specific props) import from here instead of going through
 * `renderStandardStep`.
 */
// biome-ignore lint/suspicious/noExplicitAny: registry of heterogeneous components — each has its own props shape
export const STANDARD_STEP_COMPONENTS: Record<StandardStepKind, React.ComponentType<any>> = {
	credentials: CredentialsStep,
	'container-pick': ContainerPickStep,
	'status-mapping': StatusMappingStep,
	'label-mapping': LabelMappingStep,
	'webhook-url-display': WebhookUrlDisplayStep,
	'project-scope': ProjectScopeStep,
};

const warnedKinds = new Set<string>();

function warnOnce(kind: string, providerId: string): void {
	const key = `${providerId}:${kind}`;
	if (warnedKinds.has(key)) return;
	warnedKinds.add(key);
	if (typeof console !== 'undefined') {
		console.warn(
			`[pm-wizard generator] Provider '${providerId}' declared step kind '${kind}' ` +
				`which is not a known StandardStepKind — rendering placeholder. ` +
				`Register it as a custom step on the wizard definition, or expand StandardStepKind.`,
		);
	}
}

function placeholder(kind: string, providerId: string): React.ReactElement {
	return createElement(
		'div',
		{
			'data-pm-wizard-placeholder': 'true',
			'data-provider-id': providerId,
			'data-step-kind': kind,
			style: {
				padding: '1rem',
				border: '1px dashed #aaa',
				borderRadius: '0.25rem',
				background: '#fafafa',
				color: '#666',
				fontSize: '0.85rem',
			},
		},
		`Standard step '${kind}' for provider '${providerId}' — unknown kind, rendering placeholder.`,
	);
}

/**
 * Render a wizard step. Standard kinds dispatch to their shared
 * component (props-less — caller is expected to rehydrate with actual
 * data if it wants a usable UI); custom steps render a placeholder
 * naming the custom component for the provider folder to resolve.
 *
 * The typical usage pattern for a new PM provider is:
 *
 *   import { STANDARD_STEP_COMPONENTS } from './generator.js';
 *   const CredentialsStep = STANDARD_STEP_COMPONENTS.credentials;
 *   // ... render <CredentialsStep {...providerSpecificProps} />
 *
 * rather than calling `renderStandardStep` directly — that's meant for
 * contexts where props can be inferred from `ctx.providerHooks`.
 */
export function renderStandardStep(
	step: StandardStep | CustomStep,
	ctx: WizardStepRenderContext,
): React.ReactElement {
	if (step.kind === 'custom') {
		// Custom steps live in provider folders and are resolved via the
		// existing ProviderWizardDefinition.steps path, not by the generator.
		return placeholder(`custom:${step.component}`, ctx.providerId);
	}

	const Component = STANDARD_STEP_COMPONENTS[step.kind as StandardStepKind];
	if (!Component) {
		warnOnce(step.kind, ctx.providerId);
		return placeholder(step.kind, ctx.providerId);
	}

	// Dispatch to the real component. Props beyond `step` + `providerId`
	// are expected to come through `ctx.providerHooks` (the caller's
	// responsibility). Consumers that need full control over props should
	// use `STANDARD_STEP_COMPONENTS` directly.
	return createElement(Component, {
		step,
		providerId: ctx.providerId,
		...(ctx.providerHooks ?? {}),
	});
}
