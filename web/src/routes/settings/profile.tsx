import { useMutation, useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

function ProfilePage() {
	const meQuery = useQuery(trpc.auth.me.queryOptions());
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');

	const changePasswordMutation = useMutation({
		mutationFn: (data: { password: string }) => trpcClient.auth.changePassword.mutate(data),
		onSuccess: () => {
			toast.success('Password changed successfully');
			setPassword('');
			setConfirmPassword('');
		},
		onError: (error) => {
			toast.error('Failed to change password', { description: error.message });
		},
	});

	if (meQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading profile...</div>;
	}

	if (!meQuery.data) {
		return <div className="py-8 text-center text-destructive">Failed to load profile.</div>;
	}

	const user = meQuery.data;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirmPassword) {
			toast.error('Passwords do not match');
			return;
		}
		if (password.length < 12) {
			toast.error('Password must be at least 12 characters');
			return;
		}
		changePasswordMutation.mutate({ password });
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">User Profile</h1>
				<p className="text-sm text-muted-foreground">
					Manage your account settings and change your password.
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				{/* Account Information Card */}
				<Card>
					<CardHeader>
						<CardTitle>Account Information</CardTitle>
						<CardDescription>Overview of your account details.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-3 gap-1 py-1 border-b border-border/40">
							<span className="text-sm font-medium text-muted-foreground">Name</span>
							<span className="text-sm col-span-2 font-semibold text-foreground">{user.name}</span>
						</div>
						<div className="grid grid-cols-3 gap-1 py-1 border-b border-border/40">
							<span className="text-sm font-medium text-muted-foreground">Email</span>
							<span className="text-sm col-span-2 font-semibold text-foreground">{user.email}</span>
						</div>
						<div className="grid grid-cols-3 gap-1 py-1 border-b border-border/40">
							<span className="text-sm font-medium text-muted-foreground">Role</span>
							<span className="text-sm col-span-2 capitalize font-semibold text-foreground">
								{user.role}
							</span>
						</div>
						<div className="grid grid-cols-3 gap-1 py-1">
							<span className="text-sm font-medium text-muted-foreground">Organization</span>
							<span className="text-sm col-span-2 font-semibold text-foreground">
								{user.orgName || 'N/A'}
							</span>
						</div>
					</CardContent>
				</Card>

				{/* Change Password Card */}
				<Card>
					<CardHeader>
						<CardTitle>Change Password</CardTitle>
						<CardDescription>
							Set a new password for your account. Minimum 12 characters.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="new-password">New Password</Label>
								<Input
									id="new-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Minimum 12 characters"
									minLength={12}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="confirm-password">Confirm New Password</Label>
								<Input
									id="confirm-password"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="Confirm new password"
									minLength={12}
									required
								/>
							</div>
							<div className="pt-2">
								<button
									type="submit"
									disabled={changePasswordMutation.isPending}
									className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
								>
									{changePasswordMutation.isPending ? 'Changing Password...' : 'Update Password'}
								</button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

export const settingsProfileRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/profile',
	component: ProfilePage,
});
