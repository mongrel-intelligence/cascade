/**
 * Gmail-specific step content components for the Email Wizard.
 */
import { AlertCircle, CheckCircle, Loader2, Mail } from 'lucide-react';

// ============================================================================
// GmailConnectContent
// ============================================================================

export function GmailConnectContent({
	hasGoogleOAuthCreds,
	oauthComplete,
	gmailEmail,
	onConnect,
	isConnecting,
	error,
}: {
	hasGoogleOAuthCreds: boolean;
	oauthComplete: boolean;
	gmailEmail: string | null;
	onConnect: () => void;
	isConnecting: boolean;
	error?: string | null;
}) {
	if (!hasGoogleOAuthCreds) {
		return (
			<div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
				<div className="flex items-start gap-2">
					<AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
					<div className="space-y-1">
						<p className="text-sm font-medium text-amber-700 dark:text-amber-400">
							Google OAuth not configured
						</p>
						<p className="text-xs text-amber-600 dark:text-amber-500">
							Add{' '}
							<code className="bg-amber-100 px-1 rounded dark:bg-amber-900">
								GOOGLE_OAUTH_CLIENT_ID
							</code>{' '}
							and{' '}
							<code className="bg-amber-100 px-1 rounded dark:bg-amber-900">
								GOOGLE_OAUTH_CLIENT_SECRET
							</code>{' '}
							credentials in Settings to enable Gmail OAuth.
						</p>
					</div>
				</div>
			</div>
		);
	}

	if (oauthComplete) {
		return (
			<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
				<CheckCircle className="h-4 w-4" />
				Connected as <span className="font-medium">{gmailEmail}</span>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Click below to authorize CASCADE to access your Gmail account.
			</p>
			<button
				type="button"
				onClick={onConnect}
				disabled={isConnecting}
				className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
				Connect Gmail
			</button>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}

// ============================================================================
// GmailVerifyContent
// ============================================================================

export function GmailVerifyContent({
	oauthComplete,
	gmailEmail,
	verificationEmail,
	onConfirm,
}: {
	oauthComplete: boolean;
	gmailEmail: string | null;
	verificationEmail: string | null;
	onConfirm: () => void;
}) {
	if (!oauthComplete) {
		return (
			<p className="text-sm text-muted-foreground">
				Complete Gmail OAuth in the previous step first.
			</p>
		);
	}

	return (
		<>
			<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
				<CheckCircle className="h-4 w-4" />
				Gmail connection verified for <span className="font-medium">{gmailEmail}</span>
			</div>
			{!verificationEmail && (
				<button
					type="button"
					onClick={onConfirm}
					className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<CheckCircle className="h-4 w-4" />
					Confirm
				</button>
			)}
		</>
	);
}
