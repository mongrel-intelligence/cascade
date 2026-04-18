/**
 * Shared status-mapping step component (plan 010/3).
 *
 * Renders one dropdown per CASCADE-canonical status (backlog, todo,
 * inProgress, done, canceled). Each dropdown lists the discovered provider
 * states. Changes are dispatched via `onMappingChange(cascadeStatus, stateId)`.
 */

import { createElement } from 'react';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import type { DataProps } from '@/lib/data-props.js';
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
			className: 'space-y-3',
		} as React.ComponentProps<'div'> & DataProps,
		loading
			? createElement(
					'p',
					{
						'data-state': 'loading',
						className: 'text-sm text-muted-foreground',
					} as React.ComponentProps<'p'> & DataProps,
					'Loading states…',
				)
			: error
				? createElement(
						'p',
						{
							'data-state': 'error',
							className: 'text-sm text-destructive',
						} as React.ComponentProps<'p'> & DataProps,
						`Error: ${error}`,
					)
				: createElement(
						'div',
						{ className: 'space-y-2' },
						...cascadeStatuses.map((cascade) =>
							createElement(
								'div',
								{
									key: cascade.key,
									className: 'flex items-center gap-3',
									'data-cascade-status': cascade.key,
								} as React.ComponentProps<'div'> & DataProps,
								createElement(
									Label,
									{
										htmlFor: `status-${cascade.key}`,
										className: 'w-32 shrink-0 text-xs text-muted-foreground',
									},
									cascade.label,
								),
								createElement(
									NativeSelect,
									{
										id: `status-${cascade.key}`,
										value: mappings[cascade.key] ?? '',
										onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
											onMappingChange(cascade.key, e.target.value),
										className: 'flex-1',
									},
									createElement('option', { value: '' }, '— Select —'),
									...providerStates.map((state) =>
										createElement(
											'option',
											{
												key: state.id,
												value: state.id,
												'data-category': state.category,
											} as React.ComponentProps<'option'> & DataProps,
											state.name,
										),
									),
								),
							),
						),
					),
	);
}
