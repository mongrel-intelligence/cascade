/**
 * Shared container-pick step component (plan 010/3).
 *
 * Renders a dropdown of discovered containers (Trello boards, JIRA
 * projects, Linear teams). Data flows in via `options` from the consumer
 * (which called `pm.discovery.discover` with the appropriate capability).
 * Selection is persisted via `onSelect`.
 */

import { createElement } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ContainerPickStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly /** Display label for this step's label/heading (e.g. "Select Board"). */ label?: string;
	readonly options: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly url?: string;
	}>;
	readonly selectedId: string | null;
	readonly onSelect: (id: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

export function ContainerPickStep({
	step,
	providerId,
	label,
	options,
	selectedId,
	onSelect,
	loading,
	error,
}: ContainerPickStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'container-pick',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-container-pick',
		},
		label ? createElement('label', { htmlFor: `container-${step.id}` }, label) : null,
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading...')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'select',
						{
							id: `container-${step.id}`,
							value: selectedId ?? '',
							onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onSelect(e.target.value),
							'data-action': 'select-container',
						},
						createElement('option', { value: '' }, '— Select —'),
						...options.map((opt) =>
							createElement(
								'option',
								{ key: opt.id, value: opt.id, 'data-detail': opt.url ?? undefined },
								opt.name,
							),
						),
					),
	);
}
