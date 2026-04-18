/**
 * JIRA-specific issue-type mapping step (plan 011/3).
 *
 * Registered as `kind: 'custom'` in `jiraManifest.wizardSpec`. Maps the
 * CASCADE `task` and `subtask` roles to JIRA issue types. Splits the
 * discovered `issueTypes` list by the `subtask` flag so each row only
 * shows valid options.
 *
 * Stays custom (rather than an 8th StandardStepKind) because JIRA is the
 * only PM provider with this concept today — Trello has no equivalent,
 * Linear uses workflow states. Generalizing for one consumer would be
 * speculative abstraction.
 *
 * Visual idiom mirrors the shared `status-mapping` component so the step
 * reads as a peer of the other mapping steps in the wizard.
 */

import { createElement } from 'react';
import type { CustomStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface JiraIssueType {
	readonly name: string;
	readonly subtask: boolean;
}

export interface IssueTypeMappingStepProps {
	readonly step: CustomStep;
	readonly providerId: string;
	readonly issueTypes: ReadonlyArray<JiraIssueType>;
	readonly mappings: Readonly<Record<string, string | undefined>>;
	readonly onMappingChange: (role: 'task' | 'subtask', issueTypeName: string) => void;
	readonly loading?: boolean;
	readonly error?: string;
}

const ROLES = [
	{ key: 'task' as const, label: 'Task', subtaskFlag: false },
	{ key: 'subtask' as const, label: 'Subtask', subtaskFlag: true },
];

export function IssueTypeMappingStep({
	step,
	providerId,
	issueTypes,
	mappings,
	onMappingChange,
	loading,
	error,
}: IssueTypeMappingStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'issue-type-mapping',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-issue-type-mapping',
		},
		loading
			? createElement('p', { 'data-state': 'loading' }, 'Loading issue types…')
			: error
				? createElement('p', { 'data-state': 'error' }, `Error: ${error}`)
				: createElement(
						'div',
						{ className: 'pm-wizard-issue-type-mappings' },
						...ROLES.map((role) => {
							const fieldId = `issue-type-${role.key}`;
							const filtered = issueTypes.filter((t) => t.subtask === role.subtaskFlag);
							const currentValue = mappings[role.key] ?? '';
							return createElement(
								'div',
								{
									key: role.key,
									className: 'pm-wizard-issue-type-row',
									'data-role': role.key,
								},
								createElement('label', { htmlFor: fieldId }, role.label),
								createElement(
									'select',
									{
										id: fieldId,
										value: currentValue,
										onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
											onMappingChange(role.key, e.target.value),
									},
									createElement('option', { value: '' }, '— Select —'),
									...filtered.map((t) =>
										createElement('option', { key: t.name, value: t.name }, t.name),
									),
								),
							);
						}),
					),
	);
}
