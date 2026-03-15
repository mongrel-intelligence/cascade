/**
 * Trello-specific step renderer components for PMWizard.
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

export const TRELLO_LABEL_DEFAULTS: Record<string, { name: string; color: string }> = {
	readyToProcess: { name: 'cascade-ready', color: 'sky' },
	processing: { name: 'cascade-processing', color: 'blue' },
	processed: { name: 'cascade-processed', color: 'green' },
	error: { name: 'cascade-error', color: 'red' },
	auto: { name: 'cascade-auto', color: 'purple' },
};

// ============================================================================
// TrelloCredentialsStep
// ============================================================================

export function TrelloCredentialsStep({
	state,
	dispatch,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Enter your Trello API credentials. These will be saved securely to the project.
			</p>
			<div className="space-y-2">
				<Label htmlFor="trello-api-key">API Key</Label>
				<Input
					id="trello-api-key"
					type="password"
					value={state.trelloApiKey}
					onChange={(e) => dispatch({ type: 'SET_TRELLO_API_KEY', value: e.target.value })}
					placeholder="Trello API key"
					autoComplete="off"
				/>
				<p className="text-xs text-muted-foreground">
					Find your API key at{' '}
					<a
						href="https://trello.com/app-key"
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						trello.com/app-key
					</a>
				</p>
			</div>
			<div className="space-y-2">
				<Label htmlFor="trello-token">Token</Label>
				<Input
					id="trello-token"
					type="password"
					value={state.trelloToken}
					onChange={(e) => dispatch({ type: 'SET_TRELLO_TOKEN', value: e.target.value })}
					placeholder="Trello token"
					autoComplete="off"
				/>
				<p className="text-xs text-muted-foreground">
					Generate a token from the API key page linked above.
				</p>
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
	onCreateLabel,
	onCreateAllMissingLabels,
	onCreateCostField,
	creatingSlot,
	creatingCostField,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	onCreateLabel?: (slot: string) => void;
	onCreateAllMissingLabels?: () => void;
	onCreateCostField?: () => void;
	creatingSlot?: string | null;
	creatingCostField?: boolean;
}) {
	const existingLabelNames = new Set(
		(state.trelloBoardDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
	);

	const missingSlots = TRELLO_LABEL_SLOTS.filter((slot) => {
		if (state.trelloLabelMappings[slot]) return false;
		const defaultName = TRELLO_LABEL_DEFAULTS[slot]?.name ?? '';
		return !existingLabelNames.has(defaultName.toLowerCase());
	});

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
				<div className="flex items-center justify-between">
					<Label>Label Mappings</Label>
					{state.trelloBoardDetails && missingSlots.length > 0 && onCreateAllMissingLabels && (
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
					Map each CASCADE label to a Trello label on the board.
				</p>
				{state.trelloBoardDetails ? (
					TRELLO_LABEL_SLOTS.map((slot) => {
						const isMapped = !!state.trelloLabelMappings[slot];
						const defaultInfo = TRELLO_LABEL_DEFAULTS[slot];
						const alreadyExists =
							defaultInfo && existingLabelNames.has(defaultInfo.name.toLowerCase());
						const showCreateButton = !isMapped && !alreadyExists && onCreateLabel && defaultInfo;

						return (
							<div key={slot} className="flex items-center gap-2">
								<div className="flex-1">
									<FieldMappingRow
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
						Select a board first to populate label options.
					</p>
				)}
			</div>

			{/* Cost custom field */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label>Custom Field: Cost</Label>
					{(() => {
						const existingCostField = state.trelloBoardDetails?.customFields.some(
							(f) => f.type === 'number' && f.name.toLowerCase() === 'cost',
						);
						const showCreateCostButton =
							state.trelloBoardDetails &&
							onCreateCostField &&
							!state.trelloCostFieldId &&
							!existingCostField;
						return showCreateCostButton ? (
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
						) : null;
					})()}
				</div>
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
