/**
 * Shared custom-field-mapping step component (plan 011/1 — 7th StandardStepKind).
 *
 * Renders one dropdown per CASCADE custom-field slot (e.g. cost, effort)
 * with every discovered provider custom field as an option. When the
 * `onCreateCustomField` prop is supplied, each row also exposes an inline
 * "Create…" affordance — the parent wires it to `manifest.createCustomField`
 * via the `pm.discovery.createCustomField` tRPC endpoint shipped by plan
 * 010/1.
 *
 * Visual idiom matches status-mapping.tsx (one row per CASCADE key, same
 * data-attribute conventions) so the step reads as a peer of the other
 * shared mapping steps.
 */

import { createElement, useState } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ProviderCustomField {
	readonly id: string;
	readonly name: string;
	readonly type: string;
}

export interface CustomFieldMappingStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly cascadeSlots: ReadonlyArray<{ readonly key: string; readonly label: string }>;
	readonly providerCustomFields: ReadonlyArray<ProviderCustomField>;
	readonly mappings: Readonly<Record<string, string | undefined>>;
	readonly onMappingChange: (slotKey: string, fieldId: string) => void;
	/**
	 * When supplied, each row shows a "Create…" form that calls this with
	 * the slot key + the typed-in name. Parent resolves to
	 * `pm.discovery.createCustomField(providerId, containerId, name)`. Field
	 * type is a provider concern; this component surfaces name only.
	 */
	readonly onCreateCustomField?: (slotKey: string, name: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

/** Inline row-level create form — private helper. */
function CreateCustomFieldForm({
	slotKey,
	onCreate,
}: {
	slotKey: string;
	onCreate: (slotKey: string, name: string) => void;
}) {
	const [name, setName] = useState('');
	return createElement(
		'div',
		{ className: 'pm-wizard-create-custom-field' },
		createElement('input', {
			type: 'text',
			placeholder: 'New custom field name',
			value: name,
			onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
		}),
		createElement(
			'button',
			{
				type: 'button',
				'data-action': 'create-custom-field',
				'data-slot-key': slotKey,
				disabled: name.trim() === '',
				onClick: () => {
					const trimmed = name.trim();
					if (trimmed === '') return;
					onCreate(slotKey, trimmed);
					setName('');
				},
			},
			'Create',
		),
	);
}

export function CustomFieldMappingStep({
	step,
	providerId,
	cascadeSlots,
	providerCustomFields,
	mappings,
	onMappingChange,
	onCreateCustomField,
	loading,
	error,
}: CustomFieldMappingStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'custom-field-mapping',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-custom-field-mapping',
		},
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading custom fields…')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'div',
						{ className: 'pm-wizard-custom-field-mappings' },
						...cascadeSlots.map((slot) =>
							createElement(
								'div',
								{
									key: slot.key,
									className: 'pm-wizard-custom-field-row',
									'data-cascade-slot': slot.key,
								},
								createElement('label', { htmlFor: `custom-field-${slot.key}` }, slot.label),
								createElement(
									'select',
									{
										id: `custom-field-${slot.key}`,
										value: mappings[slot.key] ?? '',
										onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
											onMappingChange(slot.key, e.target.value),
									},
									createElement('option', { value: '' }, '— Select —'),
									...providerCustomFields.map((field) =>
										createElement(
											'option',
											{ key: field.id, value: field.id, 'data-type': field.type },
											field.name,
										),
									),
								),
								onCreateCustomField
									? createElement(CreateCustomFieldForm, {
											slotKey: slot.key,
											onCreate: onCreateCustomField,
										})
									: null,
							),
						),
					),
	);
}
