/**
 * IMAP-specific step content components for the Email Wizard.
 */
import { Label } from '@/components/ui/label.js';
import { CheckCircle, Loader2, Mail, XCircle } from 'lucide-react';
import type { WizardAction, WizardState } from './email-wizard-state.js';
import { InlineCredentialCreator } from './wizard-shared.js';
import type { CredentialOption } from './wizard-shared.js';

// ============================================================================
// CredentialSelect
// ============================================================================

export function CredentialSelect({
	label,
	value,
	onChange,
	credentials,
	suggestedKey,
}: {
	label: string;
	value: number | null;
	onChange: (id: number | null) => void;
	credentials: CredentialOption[];
	suggestedKey: string;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<select
				value={value ?? ''}
				onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
				className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				<option value="">Select credential...</option>
				{credentials.map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
					</option>
				))}
			</select>
			<InlineCredentialCreator onCreated={onChange} suggestedKey={suggestedKey} />
		</div>
	);
}

// ============================================================================
// ImapConnectContent
// ============================================================================

export function ImapConnectContent({
	state,
	dispatch,
	credentials,
}: {
	state: WizardState;
	dispatch: React.Dispatch<WizardAction>;
	credentials: CredentialOption[];
}) {
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Configure IMAP and SMTP credentials for email access.
			</p>
			<div className="grid grid-cols-2 gap-4">
				<CredentialSelect
					label="IMAP Host"
					value={state.imapHostCredentialId}
					onChange={(id) => dispatch({ type: 'SET_IMAP_HOST_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_IMAP_HOST"
				/>
				<CredentialSelect
					label="IMAP Port"
					value={state.imapPortCredentialId}
					onChange={(id) => dispatch({ type: 'SET_IMAP_PORT_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_IMAP_PORT"
				/>
				<CredentialSelect
					label="SMTP Host"
					value={state.smtpHostCredentialId}
					onChange={(id) => dispatch({ type: 'SET_SMTP_HOST_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_SMTP_HOST"
				/>
				<CredentialSelect
					label="SMTP Port"
					value={state.smtpPortCredentialId}
					onChange={(id) => dispatch({ type: 'SET_SMTP_PORT_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_SMTP_PORT"
				/>
				<CredentialSelect
					label="Username/Email"
					value={state.usernameCredentialId}
					onChange={(id) => dispatch({ type: 'SET_USERNAME_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_USERNAME"
				/>
				<CredentialSelect
					label="Password/App Password"
					value={state.passwordCredentialId}
					onChange={(id) => dispatch({ type: 'SET_PASSWORD_CRED', id })}
					credentials={credentials}
					suggestedKey="EMAIL_PASSWORD"
				/>
			</div>
		</div>
	);
}

// ============================================================================
// ImapVerifyContent
// ============================================================================

export function ImapVerifyContent({
	verificationEmail,
	verifyError,
	imapCredsReady,
	isVerifying,
	onVerify,
}: {
	verificationEmail: string | null;
	verifyError: string | null;
	imapCredsReady: boolean;
	isVerifying: boolean;
	onVerify: () => void;
}) {
	return (
		<div className="space-y-4">
			{verificationEmail ? (
				<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
					<CheckCircle className="h-4 w-4" />
					IMAP connection verified for <span className="font-medium">{verificationEmail}</span>
				</div>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						Test the IMAP connection to verify credentials work.
					</p>
					<button
						type="button"
						onClick={onVerify}
						disabled={!imapCredsReady || isVerifying}
						className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{isVerifying ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Mail className="h-4 w-4" />
						)}
						Verify Connection
					</button>
				</>
			)}
			{verifyError && (
				<div className="flex items-center gap-2 text-sm text-destructive">
					<XCircle className="h-4 w-4" />
					{verifyError}
				</div>
			)}
		</div>
	);
}
