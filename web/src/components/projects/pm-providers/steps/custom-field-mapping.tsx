/**
 * Shared custom-field-mapping step component (plan 011/1 — 7th StandardStepKind;
 * styling restored post-spec-012 follow-up).
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
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import type { DataProps } from '@/lib/data-props.js';
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
	/**
	 * Plan 011/1 (forward-edit for 011/2 Trello migration): per-slot default
	 * name pre-populates the Create input. User can override. Omitting keeps
	 * the existing blank-input UX.
	 */
	readonly fieldDefaults?: Readonly<Record<string, { readonly name: string }>>;
	readonly loading?: boolean;
	readonly error?: string;
}

/** Inline row-level create form — private helper. */
function CreateCustomFieldForm({
	slotKey,
	defaultName,
	onCreate,
}: {
	slotKey: string;
	defaultName?: string;
	onCreate: (slotKey: string, name: string) => void;
}) {
	const [name, setName] = useState(defaultName ?? '');
	return createElement(
		'div',
		{ className: 'flex items-center gap-2 pl-32' },
		createElement(Input, {
			type: 'text',
			placeholder: 'New custom field name',
			value: name,
			onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
			className: 'h-8 text-xs flex-1',
		}),
		createElement(
			Button,
			{
				type: 'button',
				variant: 'outline',
				size: 'sm',
				'data-action': 'create-custom-field',
				'data-slot-key': slotKey,
				disabled: name.trim() === '',
				onClick: () => {
					const trimmed = name.trim();
					if (trimmed === '') return;
					onCreate(slotKey, trimmed);
					setName('');
				},
			} as React.ComponentProps<typeof Button> & DataProps,
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
	fieldDefaults,
	loading,
	error,
}: CustomFieldMappingStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'custom-field-mapping',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'space-y-3',
		},
		loading
			? createElement(
					'p',
					{ 'data-state': 'loading', className: 'text-sm text-muted-foreground' },
					'Loading custom fields…',
				)
			: error
				? createElement(
						'p',
						{ 'data-state': 'error', className: 'text-sm text-destructive' },
						`Error: ${error}`,
					)
				: createElement(
						'div',
						{ className: 'space-y-2' },
						...cascadeSlots.map((slot) =>
							createElement(
								'div',
								{
									key: slot.key,
									className: 'space-y-2',
									'data-cascade-slot': slot.key,
								},
								createElement(
									'div',
									{ className: 'flex items-center gap-3' },
									createElement(
										Label,
										{
											htmlFor: `custom-field-${slot.key}`,
											className: 'w-32 shrink-0 text-xs text-muted-foreground',
										},
										slot.label,
									),
									createElement(
										NativeSelect,
										{
											id: `custom-field-${slot.key}`,
											value: mappings[slot.key] ?? '',
											onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
												onMappingChange(slot.key, e.target.value),
											className: 'flex-1',
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
								),
								onCreateCustomField
									? createElement(CreateCustomFieldForm, {
											slotKey: slot.key,
											defaultName: fieldDefaults?.[slot.key]?.name,
											onCreate: onCreateCustomField,
										})
									: null,
							),
						),
					),
	);
}
