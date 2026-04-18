/**
 * Shared status-mapping step component (plan 010/3).
 *
 * Renders one dropdown per CASCADE-canonical status (backlog, todo,
 * inProgress, done, canceled). Each dropdown lists the discovered provider
 * states. Changes are dispatched via `onMappingChange(cascadeStatus, stateId)`.
 */

import { createElement } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ProviderState {
	readonly id: string;
	readonly name: string;
	readonly category?: 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown';
}

export interface StatusMappingStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly cascadeStatuses: ReadonlyArray<{ readonly key: string; readonly label: string }>;
	readonly providerStates: ReadonlyArray<ProviderState>;
	readonly mappings: Readonly<Record<string, string>>;
	readonly onMappingChange: (cascadeKey: string, stateId: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

export function StatusMappingStep({
	step,
	providerId,
	cascadeStatuses,
	providerStates,
	mappings,
	onMappingChange,
	loading,
	error,
}: StatusMappingStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'status-mapping',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-status-mapping',
		},
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading states…')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'div',
						{ className: 'pm-wizard-status-mappings' },
						...cascadeStatuses.map((cascade) =>
							createElement(
								'div',
								{
									key: cascade.key,
									className: 'pm-wizard-status-row',
									'data-cascade-status': cascade.key,
								},
								createElement('label', { htmlFor: `status-${cascade.key}` }, cascade.label),
								createElement(
									'select',
									{
										id: `status-${cascade.key}`,
										value: mappings[cascade.key] ?? '',
										onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
											onMappingChange(cascade.key, e.target.value),
									},
									createElement('option', { value: '' }, '— Select —'),
									...providerStates.map((state) =>
										createElement(
											'option',
											{ key: state.id, value: state.id, 'data-category': state.category },
											state.name,
										),
									),
								),
							),
						),
					),
	);
}
