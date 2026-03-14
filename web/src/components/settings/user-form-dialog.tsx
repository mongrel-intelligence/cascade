import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface User {
	id: string;
	name: string;
	email: string;
	role: string;
}

interface UserFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user?: User;
}

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
	const queryClient = useQueryClient();
	const isEdit = !!user;

	const [name, setName] = useState(user?.name ?? '');
	const [email, setEmail] = useState(user?.email ?? '');
	const [password, setPassword] = useState('');
	const [role, setRole] = useState<'member' | 'admin' | 'superadmin'>(
		(user?.role as 'member' | 'admin' | 'superadmin') ?? 'member',
	);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: trpc.users.list.queryOptions().queryKey });
	};

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.users.create.mutate({
				name,
				email,
				password,
				role,
			}),
		onSuccess: () => {
			invalidate();
			onOpenChange(false);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.users.update.mutate({
				id: user?.id as string,
				name,
				email,
				role,
				...(password ? { password } : {}),
			}),
		onSuccess: () => {
			invalidate();
			onOpenChange(false);
		},
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{isEdit ? 'Edit User' : 'New User'}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						activeMutation.mutate();
					}}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="user-name">Name</Label>
						<Input
							id="user-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Jane Smith"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="user-email">Email</Label>
						<Input
							id="user-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="jane@example.com"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="user-password">Password</Label>
						<Input
							id="user-password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder={isEdit ? 'Enter new password to change' : 'Password'}
							required={!isEdit}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="user-role">Role</Label>
						<select
							id="user-role"
							value={role}
							onChange={(e) => setRole(e.target.value as 'member' | 'admin' | 'superadmin')}
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
							<option value="superadmin">Superadmin</option>
						</select>
					</div>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={activeMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{activeMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
						</button>
					</div>
					{activeMutation.isError && (
						<p className="text-sm text-destructive">{activeMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
