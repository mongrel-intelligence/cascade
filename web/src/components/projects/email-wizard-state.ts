/**
 * Email Wizard state management: types, initial state, and reducer.
 * Has zero imports from other email-wizard files to avoid circular dependencies.
 */
import type { Reducer } from 'react';

// ============================================================================
// Types
// ============================================================================

export type Provider = 'gmail' | 'imap';

export interface WizardState {
	provider: Provider;
	gmailEmail: string | null;
	oauthComplete: boolean;
	imapHostCredentialId: number | null;
	imapPortCredentialId: number | null;
	smtpHostCredentialId: number | null;
	smtpPortCredentialId: number | null;
	usernameCredentialId: number | null;
	passwordCredentialId: number | null;
	verificationEmail: string | null;
	verifyError: string | null;
	isEditing: boolean;
}

export type WizardAction =
	| { type: 'SET_PROVIDER'; provider: Provider }
	| { type: 'SET_GMAIL_EMAIL'; email: string | null }
	| { type: 'SET_OAUTH_COMPLETE'; complete: boolean }
	| { type: 'SET_IMAP_HOST_CRED'; id: number | null }
	| { type: 'SET_IMAP_PORT_CRED'; id: number | null }
	| { type: 'SET_SMTP_HOST_CRED'; id: number | null }
	| { type: 'SET_SMTP_PORT_CRED'; id: number | null }
	| { type: 'SET_USERNAME_CRED'; id: number | null }
	| { type: 'SET_PASSWORD_CRED'; id: number | null }
	| { type: 'SET_VERIFICATION'; email: string | null; error?: string | null }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> };

// ============================================================================
// Initial state
// ============================================================================

export function createInitialState(): WizardState {
	return {
		provider: 'gmail',
		gmailEmail: null,
		oauthComplete: false,
		imapHostCredentialId: null,
		imapPortCredentialId: null,
		smtpHostCredentialId: null,
		smtpPortCredentialId: null,
		usernameCredentialId: null,
		passwordCredentialId: null,
		verificationEmail: null,
		verifyError: null,
		isEditing: false,
	};
}

// ============================================================================
// Reducer
// ============================================================================

export const wizardReducer: Reducer<WizardState, WizardAction> = (state, action) => {
	switch (action.type) {
		case 'SET_PROVIDER':
			return { ...createInitialState(), provider: action.provider };
		case 'SET_GMAIL_EMAIL':
			return { ...state, gmailEmail: action.email };
		case 'SET_OAUTH_COMPLETE':
			return { ...state, oauthComplete: action.complete };
		case 'SET_IMAP_HOST_CRED':
			return { ...state, imapHostCredentialId: action.id };
		case 'SET_IMAP_PORT_CRED':
			return { ...state, imapPortCredentialId: action.id };
		case 'SET_SMTP_HOST_CRED':
			return { ...state, smtpHostCredentialId: action.id };
		case 'SET_SMTP_PORT_CRED':
			return { ...state, smtpPortCredentialId: action.id };
		case 'SET_USERNAME_CRED':
			return { ...state, usernameCredentialId: action.id };
		case 'SET_PASSWORD_CRED':
			return { ...state, passwordCredentialId: action.id };
		case 'SET_VERIFICATION':
			return { ...state, verificationEmail: action.email, verifyError: action.error ?? null };
		case 'INIT_EDIT':
			return { ...state, ...action.state, isEditing: true };
		default:
			return state;
	}
};
