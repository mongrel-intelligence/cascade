/**
 * Shared label-mapping step component (plan 010/3).
 *
 * Two modes:
 * - When `providerLabels.length > 0` (Trello, Linear): render a dropdown
 *   per CASCADE label slot (processing / processed / error / ready).
 * - When `providerLabels` is empty (JIRA — free-form): render text inputs
 *   that accept any label name.
 *
 * When `onCreateLabel` is supplied (provider declares `createLabel` hook),
 * a "Create new label" button appears next to each dropdown.
 */

import { createElement, useState } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ProviderLabel {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
}

export interface LabelMappingStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly labelSlots: ReadonlyArray<{ readonly key: string; readonly label: string }>;
	readonly providerLabels: ReadonlyArray<ProviderLabel>;
	readonly mappings: Readonly<Record<string, string>>;
	readonly onMappingChange: (slotKey: string, labelValue: string) => void;
	readonly onCreateLabel?: (slotKey: string, name: string, color?: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

export function LabelMappingStep({
	step,
	providerId,
	labelSlots,
	providerLabels,
	mappings,
	onMappingChange,
	onCreateLabel,
	loading,
	error,
}: LabelMappingStepProps) {
	const [newLabelNames, setNewLabelNames] = useState<Record<string, string>>({});
	const useFreeText = providerLabels.length === 0;

	return createElement(
		'div',
		{
			'data-step-component': 'label-mapping',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			'data-mode': useFreeText ? 'free-text' : 'enum',
			className: 'pm-wizard-step pm-wizard-step-label-mapping',
		},
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading labels…')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'div',
						{ className: 'pm-wizard-label-mappings' },
						...labelSlots.map((slot) => {
							const currentValue = mappings[slot.key] ?? '';
							const fieldId = `label-${slot.key}`;

							if (useFreeText) {
								return createElement(
									'div',
									{ key: slot.key, className: 'pm-wizard-label-row', 'data-slot': slot.key },
									createElement('label', { htmlFor: fieldId }, slot.label),
									createElement('input', {
										id: fieldId,
										type: 'text',
										value: currentValue,
										onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
											onMappingChange(slot.key, e.target.value),
										placeholder: 'Label name',
									}),
								);
							}

							return createElement(
								'div',
								{ key: slot.key, className: 'pm-wizard-label-row', 'data-slot': slot.key },
								createElement('label', { htmlFor: fieldId }, slot.label),
								createElement(
									'select',
									{
										id: fieldId,
										value: currentValue,
										onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
											onMappingChange(slot.key, e.target.value),
									},
									createElement('option', { value: '' }, '— Select —'),
									...providerLabels.map((label) =>
										createElement(
											'option',
											{
												key: label.id,
												value: label.id,
												'data-color': label.color ?? undefined,
											},
											label.name,
										),
									),
								),
								onCreateLabel
									? createElement(
											'div',
											{ className: 'pm-wizard-create-label' },
											createElement('input', {
												type: 'text',
												placeholder: 'New label name',
												value: newLabelNames[slot.key] ?? '',
												onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
													setNewLabelNames((prev) => ({ ...prev, [slot.key]: e.target.value })),
											}),
											createElement(
												'button',
												{
													type: 'button',
													onClick: () => {
														const name = newLabelNames[slot.key];
														if (name) {
															onCreateLabel(slot.key, name);
															setNewLabelNames((prev) => ({ ...prev, [slot.key]: '' }));
														}
													},
													'data-action': 'create-label',
												},
												'Create label',
											),
										)
									: null,
							);
						}),
					),
	);
}
