/**
 * Trello-specific step renderer components for PMWizard.
 */
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { UseMutationResult } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { WizardAction, WizardState } from './pm-wizard-state.js';
import { FieldMappingRow, InlineCredentialCreator, SearchableSelect } from './wizard-shared.js';
import type { CredentialOption } from './wizard-shared.js';

// ============================================================================
// Slot definitions
// ============================================================================

const TRELLO_LIST_SLOTS = [
	'backlog',
	'splitting',
	'planning',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
	'debug',
];

const TRELLO_LABEL_SLOTS = ['readyToProcess', 'processing', 'processed', 'error', 'auto'];

// ============================================================================
// TrelloCredentialsStep
// ============================================================================

export function TrelloCredentialsStep({
	state,
	dispatch,
	orgCredentials,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	orgCredentials: CredentialOption[];
}) {
	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label>API Key</Label>
				<div className="flex gap-2">
					<select
						value={state.trelloApiKeyCredentialId ?? ''}
						onChange={(e) =>
							dispatch({
								type: 'SET_TRELLO_API_KEY_CRED',
								id: e.target.value ? Number(e.target.value) : null,
							})
						}
						className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="">Select credential...</option>
						{orgCredentials.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name} ({c.envVarKey}) — {c.value}
							</option>
						))}
					</select>
				</div>
				<InlineCredentialCreator
					onCreated={(id) => dispatch({ type: 'SET_TRELLO_API_KEY_CRED', id })}
				/>
			</div>
			<div className="space-y-2">
				<Label>Token</Label>
				<div className="flex gap-2">
					<select
						value={state.trelloTokenCredentialId ?? ''}
						onChange={(e) =>
							dispatch({
								type: 'SET_TRELLO_TOKEN_CRED',
								id: e.target.value ? Number(e.target.value) : null,
							})
						}
						className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="">Select credential...</option>
						{orgCredentials.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name} ({c.envVarKey}) — {c.value}
							</option>
						))}
					</select>
				</div>
				<InlineCredentialCreator
					onCreated={(id) => dispatch({ type: 'SET_TRELLO_TOKEN_CRED', id })}
				/>
			</div>
		</div>
	);
}

// ============================================================================
// TrelloBoardStep
// ============================================================================

export function TrelloBoardStep({
	state,
	onBoardSelect,
	boardsMutation,
	boardDetailsMutation,
}: {
	state: WizardState;
	onBoardSelect: (boardId: string) => void;
	boardsMutation: UseMutationResult<unknown, Error, void, unknown>;
	boardDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
}) {
	return (
		<div className="space-y-2">
			<Label>Select Board</Label>
			<SearchableSelect
				options={state.trelloBoards.map((b) => ({
					label: b.name,
					value: b.id,
					detail: b.url.split('/').pop(),
				}))}
				value={state.trelloBoardId}
				onChange={onBoardSelect}
				placeholder="Select a Trello board..."
				isLoading={boardsMutation.isPending}
				error={boardsMutation.isError ? (boardsMutation.error as Error).message : null}
				onRetry={() =>
					(boardsMutation as UseMutationResult<unknown, Error, void, unknown>).mutate()
				}
			/>
			{state.trelloBoardId && boardDetailsMutation.isPending && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading board details...
				</div>
			)}
		</div>
	);
}

// ============================================================================
// TrelloFieldMappingStep
// ============================================================================

export function TrelloFieldMappingStep({
	state,
	dispatch,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
}) {
	return (
		<div className="space-y-6">
			{/* List mappings */}
			<div className="space-y-3">
				<Label>List Mappings</Label>
				<p className="text-xs text-muted-foreground">
					Map each CASCADE stage to a Trello list on the board.
				</p>
				{state.trelloBoardDetails ? (
					TRELLO_LIST_SLOTS.map((slot) => (
						<FieldMappingRow
							key={slot}
							slotLabel={slot}
							options={
								state.trelloBoardDetails?.lists.map((l) => ({
									label: l.name,
									value: l.id,
								})) ?? []
							}
							value={state.trelloListMappings[slot] ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_TRELLO_LIST_MAPPING',
									key: slot,
									value: v,
								})
							}
							manualFallback
						/>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						Select a board first to populate list options.
					</p>
				)}
			</div>

			{/* Label mappings */}
			<div className="space-y-3">
				<Label>Label Mappings</Label>
				<p className="text-xs text-muted-foreground">
					Map each CASCADE label to a Trello label on the board.
				</p>
				{state.trelloBoardDetails ? (
					TRELLO_LABEL_SLOTS.map((slot) => (
						<FieldMappingRow
							key={slot}
							slotLabel={slot}
							options={
								state.trelloBoardDetails?.labels
									.filter((l) => l.name)
									.map((l) => ({
										label: `${l.name} (${l.color})`,
										value: l.id,
									})) ?? []
							}
							value={state.trelloLabelMappings[slot] ?? ''}
							onChange={(v) =>
								dispatch({
									type: 'SET_TRELLO_LABEL_MAPPING',
									key: slot,
									value: v,
								})
							}
							manualFallback
						/>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						Select a board first to populate label options.
					</p>
				)}
			</div>

			{/* Cost custom field */}
			<div className="space-y-2">
				<Label>Custom Field: Cost</Label>
				{state.trelloBoardDetails ? (
					<FieldMappingRow
						slotLabel="cost"
						options={state.trelloBoardDetails.customFields
							.filter((f) => f.type === 'number')
							.map((f) => ({
								label: f.name,
								value: f.id,
							}))}
						value={state.trelloCostFieldId}
						onChange={(v) => dispatch({ type: 'SET_TRELLO_COST_FIELD', id: v })}
						manualFallback
					/>
				) : (
					<Input
						value={state.trelloCostFieldId}
						onChange={(e) =>
							dispatch({
								type: 'SET_TRELLO_COST_FIELD',
								id: e.target.value,
							})
						}
						placeholder="Custom field ID for cost tracking"
					/>
				)}
			</div>
		</div>
	);
}
