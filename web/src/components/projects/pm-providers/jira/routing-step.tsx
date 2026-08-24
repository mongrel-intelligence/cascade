/**
 * JIRA team-routing step (spec 024 plan 5).
 *
 * Registered as `kind: 'custom'` in `jiraManifest.wizardSpec`. Sets the
 * discriminator that decides which of several CASCADE projects sharing one
 * JIRA project key owns a given issue.
 *
 * Optional by design and empty by default: a project that does not share a
 * board leaves this alone and saves a config byte-identical to before spec 024.
 * A key may have exactly ONE project without a discriminator — that project is
 * the key's default owner — which is why "None" is a legitimate choice rather
 * than an unfinished state.
 *
 * Stays custom rather than becoming a StandardStepKind: JIRA is the only
 * provider with shared-key routing today (spec 024 is explicitly JIRA-only,
 * with Trello and Linear able to opt in later through the same provider-generic
 * resolver). Generalising for one consumer would be speculative.
 *
 * Visual idiom mirrors the sibling mapping steps so it reads as a peer.
 */

import { createElement } from 'react';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import type { CustomStep } from '../../../../../../src/integrations/pm/manifest.js';

export type JiraRoutingKind = '' | 'label' | 'component';

export interface RoutingStepProps {
	readonly step: CustomStep;
	readonly providerId: string;
	readonly routingKind: JiraRoutingKind;
	readonly routingValue: string;
	readonly onRoutingChange: (kind: JiraRoutingKind, value: string) => void;
}

const KINDS: ReadonlyArray<{ value: JiraRoutingKind; label: string }> = [
	{ value: '', label: 'None — this project owns the whole board' },
	{ value: 'label', label: 'JIRA label' },
	{ value: 'component', label: 'JIRA component' },
];

/**
 * Mirrors the backend `jiraConfigSchema` constraint so the operator is told
 * here rather than by a save-time rejection. A quote or backslash breaks out of
 * the quoted JQL value the read path builds; whitespace in a *label* is refused
 * by JIRA itself on write, which would leave the read clause matching nothing.
 */
function describeInvalid(kind: JiraRoutingKind, value: string): string | null {
	if (!value) return null;
	if (/["\\]/.test(value)) return 'Cannot contain a double quote or backslash.';
	if (kind === 'label' && /\s/.test(value)) return 'JIRA labels cannot contain spaces.';
	return null;
}

export function RoutingStep({
	step,
	providerId,
	routingKind,
	routingValue,
	onRoutingChange,
}: RoutingStepProps) {
	const invalid = describeInvalid(routingKind, routingValue);

	return createElement(
		'div',
		{
			'data-step-component': 'jira-routing',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'space-y-3',
		},
		createElement(
			'p',
			{ className: 'text-sm text-muted-foreground' },
			'Only needed when several CASCADE projects share this JIRA project key. ' +
				'Pick the attribute that says an issue belongs to this project — issues ' +
				'carrying it route here, and work this project creates is stamped with it.',
		),
		createElement(
			'div',
			{ className: 'flex items-center gap-3' },
			createElement(
				Label,
				{ htmlFor: 'jira-routing-kind', className: 'w-32 shrink-0 text-xs text-muted-foreground' },
				'Route by',
			),
			createElement(
				NativeSelect,
				{
					id: 'jira-routing-kind',
					value: routingKind,
					onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
						onRoutingChange(e.target.value as JiraRoutingKind, routingValue),
					className: 'flex-1',
				},
				...KINDS.map((k) => createElement('option', { key: k.value, value: k.value }, k.label)),
			),
		),
		routingKind
			? createElement(
					'div',
					{ className: 'flex items-center gap-3' },
					createElement(
						Label,
						{
							htmlFor: 'jira-routing-value',
							className: 'w-32 shrink-0 text-xs text-muted-foreground',
						},
						routingKind === 'label' ? 'Label' : 'Component',
					),
					createElement(Input, {
						id: 'jira-routing-value',
						value: routingValue,
						placeholder: routingKind === 'label' ? 'team-backend' : 'Backend',
						onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
							onRoutingChange(routingKind, e.target.value),
						className: 'flex-1',
						'aria-invalid': invalid ? true : undefined,
					}),
				)
			: null,
		invalid
			? createElement(
					'p',
					{ 'data-state': 'invalid', className: 'text-sm text-destructive' },
					invalid,
				)
			: null,
		routingKind === 'component'
			? createElement(
					'p',
					{ className: 'text-xs text-muted-foreground' },
					'The component must already exist on the JIRA project — unlike labels, ' +
						'JIRA will not create it.',
				)
			: null,
	);
}
