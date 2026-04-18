/**
 * Shared container-pick step component (plan 010/3).
 *
 * Renders a dropdown of discovered containers (Trello boards, JIRA
 * projects, Linear teams). Data flows in via `options` from the consumer
 * (which called `pm.discovery.discover` with the appropriate capability).
 * Selection is persisted via `onSelect`.
 */

import { createElement } from 'react';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import type { DataProps } from '@/lib/data-props.js';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';
import { Combobox, type ComboboxOption } from '../../../ui/combobox.js';

export interface ContainerPickStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	/** Display label for this step's label/heading (e.g. "Select Board"). */
	readonly label?: string;
	readonly options: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly url?: string;
	}>;
	readonly selectedId: string | null;
	readonly onSelect: (id: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
	/**
	 * Plan 011/1: when `true`, renders the shared cmdk Combobox (searchable,
	 * type-ahead) instead of a plain <select>. Opt-in per provider via
	 * `providerHooks`. Backward-compatible default is plain <select>.
	 */
	readonly searchable?: boolean;
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
	searchable,
}: ContainerPickStepProps) {
	const comboboxOptions: ComboboxOption[] = options.map((opt) => ({
		value: opt.id,
		label: opt.name,
		detail: opt.url,
	}));

	return createElement(
		'div',
		{
			'data-step-component': 'container-pick',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'space-y-2',
		} as React.ComponentProps<'div'> & DataProps,
		label ? createElement(Label, { htmlFor: `container-${step.id}` }, label) : null,
		loading
			? createElement(
					'p',
					{
						'data-state': 'loading',
						className: 'text-sm text-muted-foreground',
					} as React.ComponentProps<'p'> & DataProps,
					'Loading...',
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
				: searchable
					? createElement(Combobox, {
							id: `container-${step.id}`,
							value: selectedId ?? '',
							onChange: onSelect,
							options: comboboxOptions,
							emptyLabel: '— Select —',
						})
					: createElement(
							NativeSelect,
							{
								id: `container-${step.id}`,
								value: selectedId ?? '',
								onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onSelect(e.target.value),
								'data-action': 'select-container',
							} as React.ComponentProps<typeof NativeSelect> & DataProps,
							createElement('option', { value: '' }, '— Select —'),
							...options.map((opt) =>
								createElement(
									'option',
									{
										key: opt.id,
										value: opt.id,
										'data-detail': opt.url ?? undefined,
									} as React.ComponentProps<'option'> & DataProps,
									opt.name,
								),
							),
						),
	);
}
