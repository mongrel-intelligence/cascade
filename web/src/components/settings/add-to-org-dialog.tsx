import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

/**
 * "Add existing account to this org" form (spec 021 plan 4, AC #1).
 *
 * Grants an already-registered CASCADE account a membership in the effective org
 * via `users.addExistingUserToOrg`, rather than creating a duplicate account.
 * The complementary path — creating a brand-new account — lives in
 * `UserFormDialog`; when that email already exists the backend returns a typed
 * CONFLICT which `UserFormDialog` already surfaces inline. This form surfaces the
 * NOT_FOUND envelope (no account owns the email → create one first) inline.
 */

export type OrgRole = 'member' | 'admin';

export interface AddToOrgResult {
	readonly email: string;
	readonly role: string;
	/** True when the account was already a member and only its role was updated. */
	readonly alreadyMember: boolean;
}

/**
 * Human-readable confirmation for a successful grant. Distinguishes a fresh grant
 * from an idempotent re-grant (which updates the per-org role) so the admin knows
 * exactly what changed.
 */
export function formatAddToOrgSuccess(result: AddToOrgResult): string {
	if (result.alreadyMember) {
		return `Updated ${result.email}'s role to ${result.role} in this organization.`;
	}
	return `Added ${result.email} to this organization as ${result.role}.`;
}

export interface AddToOrgFormProps {
	readonly email: string;
	readonly role: OrgRole;
	readonly onEmailChange: (value: string) => void;
	readonly onRoleChange: (value: OrgRole) => void;
	readonly onSubmit: () => void;
	readonly onCancel: () => void;
	readonly pending?: boolean;
	readonly errorMessage?: string | null;
	readonly successMessage?: string | null;
}

/**
 * Presentational form. Pure (no hooks) and built from SSR-safe primitives so it
 * renders under `renderToStaticMarkup` in unit tests.
 */
export function AddToOrgForm({
	email,
	role,
	onEmailChange,
	onRoleChange,
	onSubmit,
	onCancel,
	pending,
	errorMessage,
	successMessage,
}: AddToOrgFormProps) {
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
			className="space-y-4"
			data-form="add-to-org"
		>
			<p className="text-sm text-muted-foreground">
				Grant an existing CASCADE account access to this organization. To create a brand-new
				account, use <span className="font-medium text-foreground">New User</span> instead.
			</p>
			<div className="space-y-2">
				<Label htmlFor="add-to-org-email">Email</Label>
				<Input
					id="add-to-org-email"
					type="email"
					value={email}
					onChange={(e) => onEmailChange(e.target.value)}
					placeholder="jane@example.com"
					required
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="add-to-org-role">Role in this organization</Label>
				<NativeSelect
					id="add-to-org-role"
					value={role}
					onChange={(e) => onRoleChange(e.target.value as OrgRole)}
				>
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</NativeSelect>
			</div>
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={pending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{pending ? 'Adding...' : 'Add to organization'}
				</button>
			</div>
			{errorMessage && (
				<p className="text-sm text-destructive" data-message="error">
					{errorMessage}
				</p>
			)}
			{successMessage && (
				<p className="text-sm text-emerald-600 dark:text-emerald-400" data-message="success">
					{successMessage}
				</p>
			)}
		</form>
	);
}

export interface AddToOrgDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Container: dialog shell + grant mutation + member-list invalidation. */
export function AddToOrgDialog({ open, onOpenChange }: AddToOrgDialogProps) {
	const queryClient = useQueryClient();
	const [email, setEmail] = useState('');
	const [role, setRole] = useState<OrgRole>('member');
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: () => trpcClient.users.addExistingUserToOrg.mutate({ email, role }),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: trpc.users.list.queryOptions().queryKey });
			setSuccessMessage(formatAddToOrgSuccess(result));
			// Clear the email so the admin can immediately grant another account; the
			// success banner stays until they start typing again.
			setEmail('');
		},
	});

	// Reset transient state whenever the dialog is reopened so a prior grant's
	// success/error banner never leaks into a fresh session.
	// biome-ignore lint/correctness/useExhaustiveDependencies: open is the trigger; the setters and mutation.reset are stable
	useEffect(() => {
		if (open) {
			setEmail('');
			setRole('member');
			setSuccessMessage(null);
			mutation.reset();
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add existing account</DialogTitle>
				</DialogHeader>
				<AddToOrgForm
					email={email}
					role={role}
					onEmailChange={(value) => {
						setEmail(value);
						// Editing the email starts a new attempt: drop the prior result.
						setSuccessMessage(null);
						if (mutation.isError) mutation.reset();
					}}
					onRoleChange={setRole}
					onSubmit={() => mutation.mutate()}
					onCancel={() => onOpenChange(false)}
					pending={mutation.isPending}
					errorMessage={mutation.isError ? mutation.error.message : null}
					successMessage={successMessage}
				/>
			</DialogContent>
		</Dialog>
	);
}
