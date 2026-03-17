/**
 * JIRA-specific step renderer components for PMWizard.
 */
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { UseMutationResult } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import type { WizardAction, WizardState } from './pm-wizard-state.js';
import { FieldMappingRow, SearchableSelect } from './wizard-shared.js';

// ============================================================================
// Slot definitions
// ============================================================================

const JIRA_STATUS_SLOTS = [
	'backlog',
	'splitting',
	'planning',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
];

const JIRA_LABEL_SLOTS = ['processing', 'processed', 'error', 'readyToProcess', 'auto'];

// ============================================================================
// JiraCredentialsStep
// ============================================================================

export function JiraCredentialsStep({
	state,
	dispatch,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Enter your JIRA credentials. These will be saved securely to the project.
			</p>
			<div className="space-y-2">
				<Label htmlFor="jira-base-url">Base URL</Label>
				<Input
					id="jira-base-url"
					value={state.jiraBaseUrl}
					onChange={(e) => dispatch({ type: 'SET_JIRA_BASE_URL', url: e.target.value })}
					placeholder="https://your-instance.atlassian.net"
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="jira-email">Email</Label>
				<Input
					id="jira-email"
					type="email"
					value={state.jiraEmail}
					onChange={(e) => dispatch({ type: 'SET_JIRA_EMAIL', value: e.target.value })}
					placeholder="your@email.com"
					autoComplete="off"
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="jira-api-token">API Token</Label>
				<Input
					id="jira-api-token"
					type="password"
					value={state.jiraApiToken}
					onChange={(e) => dispatch({ type: 'SET_JIRA_API_TOKEN', value: e.target.value })}
					placeholder="JIRA API token"
					autoComplete="off"
				/>
				<p className="text-xs text-muted-foreground">
					Generate a token at{' '}
					<a
						href="https://id.atlassian.com/manage-profile/security/api-tokens"
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						Atlassian account settings
					</a>
				</p>
			</div>
		</div>
	);
}

// ============================================================================
// JiraProjectStep
// ============================================================================

export function JiraProjectStep({
	state,
	onProjectSelect,
	jiraProjectsMutation,
	jiraDetailsMutation,
}: {
	state: WizardState;
	onProjectSelect: (key: string) => void;
	jiraProjectsMutation: UseMutationResult<unknown, Error, void, unknown>;
	jiraDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
}) {
	return (
		<div className="space-y-2">
			<Label>Select Project</Label>
			<SearchableSelect
				options={state.jiraProjects.map((p) => ({
					label: p.name,
					value: p.key,
					detail: p.key,
				}))}
				value={state.jiraProjectKey}
				onChange={onProjectSelect}
				placeholder="Select a JIRA project..."
				isLoading={jiraProjectsMutation.isPending}
				error={jiraProjectsMutation.isError ? (jiraProjectsMutation.error as Error).message : null}
				onRetry={() =>
					(jiraProjectsMutation as UseMutationResult<unknown, Error, void, unknown>).mutate()
				}
			/>
			{state.jiraProjectKey && jiraDetailsMutation.isPending && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading project details...
				</div>
			)}
		</div>
	);
}

// ============================================================================
// JiraFieldMappingStep
// ============================================================================

export function JiraFieldMappingStep({
	state,
	dispatch,
	onCreateCostField,
	creatingCostField,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	onCreateCostField?: () => void;
	creatingCostField?: boolean;
}) {
	const existingCostField = state.jiraProjectDetails?.fields.some(
		(f) => f.name.toLowerCase() === 'cost',
	);
	const showCreateCostButton =
		state.jiraProjectDetails && onCreateCostField && !state.jiraCostFieldId && !existingCostField;

	return (
		<div className="space-y-6">
			{/* Status mappings */}
			<div className="space-y-3">
				<Label>Status Mappings</Label>
				<p className="text-xs text-muted-foreground">
					Map each CASCADE status to a JIRA status in the project.
				</p>
				{state.jiraProjectDetails ? (
					JIRA_STATUS_SLOTS.map((slot) => (
						<FieldMappingRow
							key={slot}
							slotLabel={slot}
							options={
								state.jiraProjectDetails?.statuses.map((s) => ({
									label: s.name,
									value: s.name,
								})) ?? []
							}
							value={state.jiraStatusMappings[slot] ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_JIRA_STATUS_MAPPING',
									key: slot,
									value: v,
								})
							}
							manualFallback
						/>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						Select a project first to populate status options.
					</p>
				)}
			</div>

			{/* Issue types */}
			<div className="space-y-3">
				<Label>Issue Types (optional)</Label>
				<p className="text-xs text-muted-foreground">
					Map CASCADE issue types. Typically &quot;task&quot; for the main type and
					&quot;subtask&quot; for sub-tasks.
				</p>
				{state.jiraProjectDetails ? (
					<>
						<FieldMappingRow
							slotLabel="task"
							options={state.jiraProjectDetails.issueTypes
								.filter((t) => !t.subtask)
								.map((t) => ({
									label: t.name,
									value: t.name,
								}))}
							value={state.jiraIssueTypes.task ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_JIRA_ISSUE_TYPE',
									key: 'task',
									value: v,
								})
							}
							manualFallback
						/>
						<FieldMappingRow
							slotLabel="subtask"
							options={state.jiraProjectDetails.issueTypes
								.filter((t) => t.subtask)
								.map((t) => ({
									label: t.name,
									value: t.name,
								}))}
							value={state.jiraIssueTypes.subtask ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_JIRA_ISSUE_TYPE',
									key: 'subtask',
									value: v,
								})
							}
							manualFallback
						/>
					</>
				) : (
					<p className="text-sm text-muted-foreground">Select a project first.</p>
				)}
			</div>

			{/* Labels */}
			<div className="space-y-3">
				<Label>Labels</Label>
				<p className="text-xs text-muted-foreground">
					CASCADE label names used in JIRA. These are created automatically by CASCADE.
				</p>
				{JIRA_LABEL_SLOTS.map((slot) => (
					<div key={slot} className="flex items-center gap-2">
						<span className="w-28 shrink-0 text-sm text-muted-foreground">{slot}</span>
						<Input
							value={state.jiraLabels[slot] ?? ''}
							onChange={(e) =>
								dispatch({
									type: 'SET_JIRA_LABEL',
									key: slot,
									value: e.target.value,
								})
							}
							placeholder={`JIRA label for ${slot}`}
							className="flex-1"
						/>
					</div>
				))}
			</div>

			{/* Cost custom field */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label>Custom Field: Cost</Label>
					{showCreateCostButton && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onCreateCostField}
							disabled={creatingCostField}
							className="h-7 text-xs"
						>
							{creatingCostField ? (
								<Loader2 className="h-3 w-3 animate-spin mr-1" />
							) : (
								<Plus className="h-3 w-3 mr-1" />
							)}
							Create
						</Button>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					JIRA custom fields are global and require admin permissions to create.
				</p>
				{state.jiraProjectDetails ? (
					<FieldMappingRow
						slotLabel="cost"
						options={state.jiraProjectDetails.fields.map((f) => ({
							label: `${f.name} (${f.id})`,
							value: f.id,
						}))}
						value={state.jiraCostFieldId}
						onChange={(v) => dispatch({ type: 'SET_JIRA_COST_FIELD', id: v })}
						manualFallback
					/>
				) : (
					<Input
						value={state.jiraCostFieldId}
						onChange={(e) =>
							dispatch({
								type: 'SET_JIRA_COST_FIELD',
								id: e.target.value,
							})
						}
						placeholder="e.g., customfield_10042"
					/>
				)}
			</div>
		</div>
	);
}
