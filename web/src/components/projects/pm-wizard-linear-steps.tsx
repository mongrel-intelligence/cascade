/**
 * Linear-specific step renderer components for PMWizard.
 *
 * **Retained until plan 011/5 — see spec 011 AC #4.** Plan 011/4 migrated
 * the Linear wizard to the shared step components + widened
 * `webhook-url-display` composition. This file has no production consumer
 * (the only surviving export `LINEAR_LABEL_DEFAULTS` was duplicated into
 * `pm-providers/linear/wizard.ts`).
 */

import type { UseMutationResult } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { WizardAction, WizardState } from './pm-wizard-state.js';
import { FieldMappingRow, SearchableSelect } from './wizard-shared.js';

// ============================================================================
// Slot definitions
// ============================================================================

const LINEAR_STATUS_SLOTS = [
	'backlog',
	'splitting',
	'planning',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
] as const;

const LINEAR_LABEL_SLOTS = ['processing', 'processed', 'error', 'readyToProcess', 'auto'];

/**
 * Default CASCADE label names + hex colors used when the operator clicks
 * "Create" on an unmapped slot. Linear expects hex color strings on
 * issueLabelCreate; picked to roughly match the Trello named-color palette.
 */
export const LINEAR_LABEL_DEFAULTS: Record<string, { name: string; color: string }> = {
	readyToProcess: { name: 'cascade-ready', color: '#0284C7' },
	processing: { name: 'cascade-processing', color: '#2563EB' },
	processed: { name: 'cascade-processed', color: '#16A34A' },
	error: { name: 'cascade-error', color: '#DC2626' },
	auto: { name: 'cascade-auto', color: '#9333EA' },
};

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
	dispatch,
	linearTeamsMutation,
	linearDetailsMutation,
	linearProjectsMutation,
}: {
	state: WizardState;
	onTeamSelect: (id: string) => void;
	dispatch: React.Dispatch<WizardAction>;
	linearTeamsMutation: UseMutationResult<unknown, Error, void, unknown>;
	linearDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
	linearProjectsMutation: UseMutationResult<unknown, Error, string, unknown>;
}) {
	return (
		<div className="space-y-4">
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

			{state.linearTeamId && (
				<div className="space-y-2">
					<Label>Linear Project (optional)</Label>
					<SearchableSelect
						options={state.linearProjects.map((p) => ({
							label: p.name,
							value: p.id,
						}))}
						value={state.linearProjectId}
						onChange={(v) => dispatch({ type: 'SET_LINEAR_PROJECT_ID', value: v })}
						placeholder="No project scope — all team issues"
						isLoading={linearProjectsMutation.isPending}
						error={
							linearProjectsMutation.isError
								? (linearProjectsMutation.error as Error).message
								: null
						}
						onRetry={() => linearProjectsMutation.mutate(state.linearTeamId)}
					/>
					<p className="text-xs text-muted-foreground">
						Optional — leave empty to process all issues in this team. When set, CASCADE only
						responds to issues that belong to this Linear Project.
					</p>
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
	onCreateLabel,
	onCreateAllMissingLabels,
	creatingSlot,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	onCreateLabel?: (slot: string) => void;
	onCreateAllMissingLabels?: () => void;
	creatingSlot?: string | null;
}) {
	const existingLabelNames = new Set(
		(state.linearTeamDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
	);

	const missingSlots = LINEAR_LABEL_SLOTS.filter((slot) => {
		if (state.linearLabels[slot]) return false;
		const defaultName = LINEAR_LABEL_DEFAULTS[slot]?.name ?? '';
		return !existingLabelNames.has(defaultName.toLowerCase());
	});

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
							// Linear webhooks deliver state UUIDs in data.stateId; the
							// status-changed trigger does strict-equality matching, so
							// the saved mapping value MUST be the state ID, not the name.
							options={
								state.linearTeamDetails?.states.map((s) => ({
									label: s.name,
									value: s.id,
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

			{/* Label mappings */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<Label>Label Mappings</Label>
					{state.linearTeamDetails && missingSlots.length > 0 && onCreateAllMissingLabels && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onCreateAllMissingLabels}
							disabled={creatingSlot !== null}
							className="h-7 text-xs"
						>
							{creatingSlot === '__batch__' ? (
								<Loader2 className="h-3 w-3 animate-spin mr-1" />
							) : (
								<Plus className="h-3 w-3 mr-1" />
							)}
							Create All Missing ({missingSlots.length})
						</Button>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					Map each CASCADE label to a Linear label on the team. Click "Create" to add missing ones.
				</p>
				{state.linearTeamDetails ? (
					LINEAR_LABEL_SLOTS.map((slot) => {
						const isMapped = !!state.linearLabels[slot];
						const defaultInfo = LINEAR_LABEL_DEFAULTS[slot];
						const alreadyExists =
							defaultInfo && existingLabelNames.has(defaultInfo.name.toLowerCase());
						const showCreateButton = !isMapped && !alreadyExists && onCreateLabel && defaultInfo;

						return (
							<div key={slot} className="flex items-center gap-2">
								<div className="flex-1">
									<FieldMappingRow
										slotLabel={slot}
										// Linear's issueUpdate.labelIds requires UUIDs; saving names
										// causes the label application to silently fail server-side.
										options={
											state.linearTeamDetails?.labels
												.filter((l) => l.name)
												.map((l) => ({
													label: `${l.name} (${l.color})`,
													value: l.id,
												})) ?? []
										}
										value={state.linearLabels[slot] ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_LINEAR_LABEL',
												key: slot,
												value: v,
											})
										}
										manualFallback
									/>
								</div>
								{showCreateButton && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => onCreateLabel(slot)}
										disabled={creatingSlot !== null}
										className="h-8 text-xs shrink-0 text-muted-foreground hover:text-foreground"
										title={`Create "${defaultInfo.name}" (${defaultInfo.color})`}
									>
										{creatingSlot === slot ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<Plus className="h-3 w-3" />
										)}
										Create
									</Button>
								)}
							</div>
						);
					})
				) : (
					<p className="text-sm text-muted-foreground">
						Select a team first to populate label options.
					</p>
				)}
			</div>
		</div>
	);
}
