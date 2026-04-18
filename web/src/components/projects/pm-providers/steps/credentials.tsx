/**
 * Shared credentials step component (plan 010/3; styling restored
 * post-spec-012 follow-up).
 *
 * Renders a labeled input for each credential role declared on the
 * provider's manifest `credentialRoles` slots. Uses `providerHooks` to
 * read current values from wizard state and dispatch changes.
 *
 * Restored to use shadcn primitives (`Input`, `Label`, `Button`) matching
 * the legacy per-provider components. The raw-HTML version shipped
 * invisible inputs on dark theme.
 */

import { createElement, Fragment } from 'react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { DataProps } from '@/lib/data-props.js';
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
			className: 'space-y-4',
		},
		createElement(
			'div',
			{ className: 'space-y-4' },
			...credentialRoles.map((role) =>
				createElement(
					'div',
					{
						key: role.role,
						className: 'space-y-2',
						'data-role': role.role,
					} as React.ComponentProps<'div'> & DataProps,
					createElement(
						Label,
						{ htmlFor: `cred-${role.role}` },
						`${role.label}${role.optional ? ' (optional)' : ''}`,
					),
					createElement(Input, {
						id: `cred-${role.role}`,
						type:
							role.role.includes('password') || role.role.includes('token') ? 'password' : 'text',
						value: values[role.role] ?? '',
						onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
							onChange(role.role, e.target.value),
						autoComplete: 'off',
					}),
				),
			),
		),
		onVerify
			? createElement(
					'div',
					{ className: 'flex items-center gap-3 pt-2' },
					createElement(
						Button,
						{
							type: 'button',
							variant: 'outline',
							size: 'sm',
							onClick: onVerify,
							'data-action': 'verify',
						} as React.ComponentProps<typeof Button> & DataProps,
						'Verify credentials',
					),
					verificationDisplay
						? createElement(
								'p',
								{
									className: 'text-sm text-green-600 dark:text-green-400',
									'data-verification': 'success',
								} as React.ComponentProps<'p'> & DataProps,
								`Verified as ${verificationDisplay}`,
							)
						: null,
					verificationError
						? createElement(
								'p',
								{
									className: 'text-sm text-destructive',
									'data-verification': 'error',
								} as React.ComponentProps<'p'> & DataProps,
								`Verification failed: ${verificationError}`,
							)
						: null,
				)
			: createElement(Fragment),
	);
}
