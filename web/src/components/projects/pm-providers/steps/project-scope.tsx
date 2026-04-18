/**
 * Shared project-scope step component (plan 010/3).
 *
 * For providers with a nested "project" concept (e.g. Linear — team
 * contains projects), renders a dropdown with "No project scope" + one
 * option per discovered project. Persists the selection via
 * `onSelect(projectId | null)`.
 */

import { createElement } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ProjectScopeStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly selectedProjectId: string | null;
	readonly onSelect: (projectId: string | null) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

export function ProjectScopeStep({
	step,
	providerId,
	projects,
	selectedProjectId,
	onSelect,
	loading,
	error,
}: ProjectScopeStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'project-scope',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-project-scope',
		},
		createElement(
			'label',
			{ htmlFor: `project-scope-${step.id}` },
			'Optional: narrow scope to a project',
		),
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading projects…')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'select',
						{
							id: `project-scope-${step.id}`,
							value: selectedProjectId ?? '',
							onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
								onSelect(e.target.value === '' ? null : e.target.value),
							'data-action': 'select-project-scope',
						},
						createElement('option', { value: '' }, 'No project scope'),
						...projects.map((p) => createElement('option', { key: p.id, value: p.id }, p.name)),
					),
	);
}
