import { UserFormDialog } from '@/components/settings/user-form-dialog.js';
import { UsersTable } from '@/components/settings/users-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function UsersPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const usersQuery = useQuery(trpc.users.list.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Users</h1>
					<p className="text-sm text-muted-foreground">
						Manage organization users and their roles.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					New User
				</button>
			</div>

			{usersQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading users...</div>
			)}

			{usersQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load users: {usersQuery.error.message}
				</div>
			)}

			{usersQuery.data && <UsersTable users={usersQuery.data} />}

			<UserFormDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}

export const settingsUsersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/users',
	component: UsersPage,
});
