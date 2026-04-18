/**
 * Shared project-scope step component (plan 010/3).
 *
 * For providers with a nested "project" concept (e.g. Linear — team
 * contains projects), renders a dropdown with "No project scope" + one
 * option per discovered project. Persists the selection via
 * `onSelect(projectId | null)`.
 */

import { createElement } from 'react';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import type { DataProps } from '@/lib/data-props.js';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';
import { Combobox, type ComboboxOption } from '../../../ui/combobox.js';

export interface ProjectScopeStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly selectedProjectId: string | null;
	readonly onSelect: (projectId: string | null) => void;
	readonly loading?: boolean;
	readonly error?: string;
	/**
	 * Plan 011/1: opt-in to the shared cmdk Combobox for searchable/
	 * type-ahead selection. Empty value (cleared) maps to null (no scope).
	 */
	readonly searchable?: boolean;
}

export function ProjectScopeStep({
	step,
	providerId,
	projects,
	selectedProjectId,
	onSelect,
	loading,
	error,
	searchable,
}: ProjectScopeStepProps) {
	const comboboxOptions: ComboboxOption[] = projects.map((p) => ({
		value: p.id,
		label: p.name,
	}));

	return createElement(
		'div',
		{
			'data-step-component': 'project-scope',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'space-y-2',
		},
		createElement(
			Label,
			{ htmlFor: `project-scope-${step.id}` },
			'Optional: narrow scope to a project',
		),
		loading
			? createElement(
					'p',
					{ 'data-state': 'loading', className: 'text-sm text-muted-foreground' },
					'Loading projects…',
				)
			: error
				? createElement(
						'p',
						{ 'data-state': 'error', className: 'text-sm text-destructive' },
						`Error: ${error}`,
					)
				: searchable
					? createElement(Combobox, {
							id: `project-scope-${step.id}`,
							value: selectedProjectId ?? '',
							onChange: (v: string) => onSelect(v === '' ? null : v),
							options: comboboxOptions,
							emptyLabel: 'No project scope',
						})
					: createElement(
							NativeSelect,
							{
								id: `project-scope-${step.id}`,
								value: selectedProjectId ?? '',
								onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
									onSelect(e.target.value === '' ? null : e.target.value),
								'data-action': 'select-project-scope',
							} as React.ComponentProps<typeof NativeSelect> & DataProps,
							createElement('option', { value: '' }, 'No project scope'),
							...projects.map((p) => createElement('option', { key: p.id, value: p.id }, p.name)),
						),
	);
}
