/**
 * Linear-specific step renderer components for PMWizard.
 */

import type { UseMutationResult } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { WizardAction, WizardState } from './pm-wizard-state.js';
import { FieldMappingRow, SearchableSelect } from './wizard-shared.js';

// ============================================================================
// Slot definitions
// ============================================================================

const LINEAR_STATUS_SLOTS = ['backlog', 'inProgress', 'inReview', 'done'];

const LINEAR_LABEL_SLOTS = ['processing', 'processed', 'error', 'readyToProcess', 'auto'];

// ============================================================================
// LinearCredentialsStep
// ============================================================================

export function LinearCredentialsStep({
	state,
	dispatch,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
}) {
	return (
		<div className="space-y-4">
			{state.isEditing && state.hasStoredCredentials && !state.linearApiKey && (
				<div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
					<CheckCircle2 className="h-4 w-4 shrink-0" />
					Credentials stored — enter new values below to replace them.
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				Enter your Linear API key. This will be saved securely to the project.
			</p>
			<div className="space-y-2">
				<Label htmlFor="linear-api-key">API Key</Label>
				<Input
					id="linear-api-key"
					type="password"
					value={state.linearApiKey}
					onChange={(e) => dispatch({ type: 'SET_LINEAR_API_KEY', value: e.target.value })}
					placeholder="lin_api_..."
					autoComplete="off"
				/>
				<p className="text-xs text-muted-foreground">
					Generate a Personal API key at{' '}
					<a
						href="https://linear.app/settings/api"
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						linear.app/settings/api
					</a>
				</p>
			</div>
		</div>
	);
}

// ============================================================================
// LinearTeamStep
// ============================================================================

export function LinearTeamStep({
	state,
	onTeamSelect,
	linearTeamsMutation,
	linearDetailsMutation,
}: {
	state: WizardState;
	onTeamSelect: (id: string) => void;
	linearTeamsMutation: UseMutationResult<unknown, Error, void, unknown>;
	linearDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
}) {
	return (
		<div className="space-y-2">
			<Label>Select Team</Label>
			<SearchableSelect
				options={state.linearTeams.map((t) => ({
					label: t.name,
					value: t.id,
					detail: t.key,
				}))}
				value={state.linearTeamId}
				onChange={onTeamSelect}
				placeholder="Select a Linear team..."
				isLoading={linearTeamsMutation.isPending}
				error={linearTeamsMutation.isError ? (linearTeamsMutation.error as Error).message : null}
				onRetry={() =>
					(linearTeamsMutation as UseMutationResult<unknown, Error, void, unknown>).mutate()
				}
			/>
			{state.linearTeamId && linearDetailsMutation.isPending && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading team details...
				</div>
			)}
		</div>
	);
}

// ============================================================================
// LinearFieldMappingStep
// ============================================================================

export function LinearFieldMappingStep({
	state,
	dispatch,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
}) {
	return (
		<div className="space-y-6">
			{/* Status mappings */}
			<div className="space-y-3">
				<Label>Status Mappings</Label>
				<p className="text-xs text-muted-foreground">
					Map each CASCADE status to a Linear workflow state in the team.
				</p>
				{state.linearTeamDetails ? (
					LINEAR_STATUS_SLOTS.map((slot) => (
						<FieldMappingRow
							key={slot}
							slotLabel={slot}
							options={
								state.linearTeamDetails?.states.map((s) => ({
									label: s.name,
									value: s.name,
								})) ?? []
							}
							value={state.linearStatusMappings[slot] ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_LINEAR_STATUS_MAPPING',
									key: slot,
									value: v,
								})
							}
							manualFallback
						/>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						Select a team first to populate status options.
					</p>
				)}
			</div>

			{/* Labels */}
			<div className="space-y-3">
				<Label>Labels</Label>
				<p className="text-xs text-muted-foreground">
					CASCADE label names used in Linear. These are created automatically by CASCADE.
				</p>
				{LINEAR_LABEL_SLOTS.map((slot) => (
					<div key={slot} className="flex items-center gap-2">
						<span className="w-28 shrink-0 text-sm text-muted-foreground">{slot}</span>
						<Input
							value={state.linearLabels[slot] ?? ''}
							onChange={(e) =>
								dispatch({
									type: 'SET_LINEAR_LABEL',
									key: slot,
									value: e.target.value,
								})
							}
							placeholder={`Linear label for ${slot}`}
							className="flex-1"
						/>
					</div>
				))}
			</div>
		</div>
	);
}
