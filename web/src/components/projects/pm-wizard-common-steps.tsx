/**
 * Provider-agnostic step renderer components for PMWizard.
 *
 * **Plan 012/4 (2026-04-18+):** `WebhookStep` + `LinearWebhookInfoPanel`
 * deleted. Every PM provider now owns its webhook step via the manifest
 * path (see `./pm-providers/<provider>/webhook-step.tsx`). Only
 * `SaveStep` remains in this file — it's the one cross-provider step
 * that doesn't fit the per-provider-step model (operates on the
 * `saveMutation` from the parent wizard).
 */

import type { UseMutationResult } from '@tanstack/react-query';
import type { WizardState } from './pm-wizard-state.js';

export function SaveStep({
	state,
	saveMutation,
}: {
	state: WizardState;
	saveMutation: UseMutationResult<unknown, Error, void, unknown>;
}) {
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending
						? 'Saving...'
						: state.isEditing
							? 'Update Integration'
							: 'Save Integration'}
				</button>
				{saveMutation.isSuccess && (
					<span className="text-sm text-green-600 dark:text-green-400">
						Integration saved successfully.
					</span>
				)}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{(saveMutation.error as Error).message}</span>
				)}
			</div>
		</div>
	);
}
