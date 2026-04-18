/**
 * Shared credentials step component (plan 010/3).
 *
 * Renders a labeled text input for each credential role declared on the
 * provider's manifest `credentialRoles` slots. Uses `providerHooks` to
 * read current values from wizard state and dispatch changes.
 *
 * This component is **new code for new PM providers going forward**.
 * The three existing providers (Trello/JIRA/Linear) keep using their
 * per-provider step files (`pm-wizard-<provider>-steps.tsx`). A follow-up
 * plan will migrate those.
 */

import { createElement, Fragment } from 'react';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface CredentialRoleSpec {
	readonly role: string;
	readonly label: string;
	readonly optional?: boolean;
}

export interface CredentialsStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly credentialRoles: readonly CredentialRoleSpec[];
	readonly values: Readonly<Record<string, string>>;
	readonly onChange: (role: string, value: string) => void;
	readonly onVerify?: () => void;
	readonly verificationDisplay?: string;
	readonly verificationError?: string;
}

export function CredentialsStep({
	step,
	providerId,
	credentialRoles,
	values,
	onChange,
	onVerify,
	verificationDisplay,
	verificationError,
}: CredentialsStepProps) {
	return createElement(
		'div',
		{
			'data-step-component': 'credentials',
			'data-provider-id': providerId,
			'data-step-id': step.id,
			className: 'pm-wizard-step pm-wizard-step-credentials',
		},
		createElement(
			'div',
			{ className: 'pm-wizard-step-fields' },
			...credentialRoles.map((role) =>
				createElement(
					'div',
					{
						key: role.role,
						className: 'pm-wizard-field',
						'data-role': role.role,
					},
					createElement(
						'label',
						{ htmlFor: `cred-${role.role}` },
						`${role.label}${role.optional ? ' (optional)' : ''}`,
					),
					createElement('input', {
						id: `cred-${role.role}`,
						type:
							role.role.includes('password') || role.role.includes('token') ? 'password' : 'text',
						value: values[role.role] ?? '',
						onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
							onChange(role.role, e.target.value),
					}),
				),
			),
		),
		onVerify
			? createElement(
					'div',
					{ className: 'pm-wizard-verify' },
					createElement(
						'button',
						{ type: 'button', onClick: onVerify, 'data-action': 'verify' },
						'Verify credentials',
					),
					verificationDisplay
						? createElement(
								'p',
								{ className: 'pm-wizard-verify-success', 'data-verification': 'success' },
								`Verified as ${verificationDisplay}`,
							)
						: null,
					verificationError
						? createElement(
								'p',
								{ className: 'pm-wizard-verify-error', 'data-verification': 'error' },
								`Verification failed: ${verificationError}`,
							)
						: null,
				)
			: createElement(Fragment),
	);
}
