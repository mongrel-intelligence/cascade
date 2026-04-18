/**
 * Trello-specific OAuth credentials step (plan 011/2).
 *
 * Replaces the legacy `TrelloCredentialsStep` (retired + deleted by
 * plan 011/5). Registered as a `kind: 'custom'` step in
 * `trelloManifest.wizardSpec` and resolved by the Trello
 * ProviderWizardDefinition (see `./wizard.ts`).
 *
 * Why custom: the Trello OAuth flow opens `trello.com/1/authorize` in a
 * popup (`window.open`) and relies on the user pasting the token back
 * into a manual textarea (Trello's return-URL whitelisting is
 * incompatible with our dev-and-prod setup). Both the popup lifecycle
 * and the manual fallback are Trello-specific — can't be generalized
 * into the shared `credentials` step without leaking Trello semantics.
 *
 * Props shape matches `ProviderWizardStepProps` (standard for any step
 * the Trello wizard definition renders).
 */

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { ProviderWizardStepProps } from '../types.js';

export function TrelloOAuthStep({ state, dispatch }: ProviderWizardStepProps) {
	const popupRef = useRef<Window | null>(null);
	const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
	// Start open if a token is already present (e.g. edit mode) so the user can see and change it.
	const [manualOpen, setManualOpen] = useState(!!state.trelloToken);

	function openAuthPopup() {
		// Omitting return_url: Trello enforces an origin allowlist that users haven't configured,
		// so redirecting back is not reliable. Without it, Trello displays the token on-screen
		// after "Allow" and the user pastes it in below.
		const url = `https://trello.com/1/authorize?key=${encodeURIComponent(state.trelloApiKey)}&name=CASCADE&expiration=never&scope=read,write&response_type=token`;
		const popup = window.open(url, 'trello_oauth', 'width=600,height=700');
		if (!popup) {
			toast.error('Popup blocked', {
				description: 'Allow popups for this site, then try again.',
			});
			return;
		}
		popupRef.current = popup;
		setIsWaitingForAuth(true);
		setManualOpen(true);
	}

	// Detect the user closing the popup without completing authorization.
	useEffect(() => {
		if (!isWaitingForAuth) return;
		const interval = setInterval(() => {
			if (popupRef.current?.closed) {
				popupRef.current = null;
				setIsWaitingForAuth(false);
			}
		}, 500);
		return () => clearInterval(interval);
	}, [isWaitingForAuth]);

	return (
		<div className="space-y-4">
			{state.isEditing && state.hasStoredCredentials && !state.trelloApiKey && (
				<div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
					<CheckCircle2 className="h-4 w-4 shrink-0" />
					Credentials stored — enter new values below to replace them.
				</div>
			)}
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
				<Label>Authorization</Label>
				{state.trelloToken ? (
					<div className="flex items-center gap-2">
						<CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />
						<span className="text-sm text-green-600 dark:text-green-400">Token set</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={openAuthPopup}
							disabled={!state.trelloApiKey || isWaitingForAuth}
							data-action="trello-oauth-start"
						>
							{isWaitingForAuth ? (
								<>
									<Loader2 className="mr-1 h-3 w-3 animate-spin" />
									Waiting...
								</>
							) : (
								'Re-authorize'
							)}
						</Button>
					</div>
				) : (
					<Button
						type="button"
						variant="outline"
						onClick={openAuthPopup}
						disabled={!state.trelloApiKey || isWaitingForAuth}
						data-action="trello-oauth-start"
					>
						{isWaitingForAuth ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Waiting for authorization...
							</>
						) : (
							'Authorize with Trello'
						)}
					</Button>
				)}
				<p className="text-xs text-muted-foreground">
					{state.trelloApiKey
						? 'Click to open Trello authorization in a popup.'
						: 'Enter your API key above to enable authorization.'}
				</p>
			</div>
			<details open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
				<summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
					Enter token manually
				</summary>
				<div className="mt-2 space-y-2">
					<Label htmlFor="trello-token-manual">Token</Label>
					<Input
						id="trello-token-manual"
						type="password"
						value={state.trelloToken}
						onChange={(e) => dispatch({ type: 'SET_TRELLO_TOKEN', value: e.target.value })}
						placeholder="Trello token"
						autoComplete="off"
					/>
					<p className="text-xs text-muted-foreground">
						{isWaitingForAuth
							? 'After clicking "Allow" in the Trello popup, copy the token shown and paste it above.'
							: 'Generate a token from the API key page linked above.'}
					</p>
				</div>
			</details>
		</div>
	);
}
