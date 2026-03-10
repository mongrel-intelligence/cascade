/**
 * Provider-agnostic step content components for the Email Wizard:
 * ProviderStep, SaveStep, and STEP_TITLES.
 */
import { Label } from '@/components/ui/label.js';
import type { UseMutationResult } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import type { WizardAction, WizardState } from './email-wizard-state.js';

// ============================================================================
// Step titles
// ============================================================================

export const STEP_TITLES = ['Provider', 'Connect', 'Verify', 'Save'] as const;

// ============================================================================
// ProviderStep
// ============================================================================

export function ProviderStep({
	state,
	dispatch,
	advanceToStep,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	advanceToStep: (step: number) => void;
}) {
	const baseButtonClass =
		'flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors';
	const activeClass = 'border-primary bg-primary/5 text-foreground';
	const inactiveClass =
		'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50';
	const disabledClass = state.isEditing ? 'cursor-not-allowed opacity-60' : '';

	return (
		<div className="space-y-2">
			<Label>Email Provider</Label>
			<div className="flex gap-2">
				<button
					type="button"
					disabled={state.isEditing}
					onClick={() => {
						dispatch({ type: 'SET_PROVIDER', provider: 'gmail' });
						advanceToStep(2);
					}}
					className={`${baseButtonClass} ${state.provider === 'gmail' ? activeClass : inactiveClass} ${disabledClass}`}
				>
					<Mail className="h-4 w-4 inline-block mr-2" />
					Gmail (OAuth)
				</button>
				<button
					type="button"
					disabled={state.isEditing}
					onClick={() => {
						dispatch({ type: 'SET_PROVIDER', provider: 'imap' });
						advanceToStep(2);
					}}
					className={`${baseButtonClass} ${state.provider === 'imap' ? activeClass : inactiveClass} ${disabledClass}`}
				>
					IMAP / SMTP
				</button>
			</div>
			<p className="text-xs text-muted-foreground">
				{state.provider === 'gmail'
					? 'Connect with Google OAuth. No app password required.'
					: 'Use IMAP/SMTP credentials (works with any email provider).'}
			</p>
		</div>
	);
}

// ============================================================================
// SaveStep
// ============================================================================

export function SaveStep({
	state,
	saveMutation,
	step3Complete,
}: {
	state: WizardState;
	saveMutation: UseMutationResult<{ success: boolean }, Error, void, unknown>;
	step3Complete: boolean;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
				<div className="flex justify-between">
					<span className="text-muted-foreground">Provider</span>
					<span className="font-medium">
						{state.provider === 'gmail' ? 'Gmail (OAuth)' : 'IMAP/SMTP'}
					</span>
				</div>
				{state.verificationEmail && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">Email</span>
						<span className="font-medium">{state.verificationEmail}</span>
					</div>
				)}
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={!step3Complete || saveMutation.isPending}
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
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}
