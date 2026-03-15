import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.js';
import { Badge } from '@/components/ui/badge.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { UserFormDialog } from './user-form-dialog.js';

interface User {
	id: string;
	orgId: string;
	name: string;
	email: string;
	role: string;
	createdAt: string | null;
	updatedAt: string | null;
}

function roleVariant(role: string): 'default' | 'secondary' | 'destructive' | 'outline' {
	if (role === 'superadmin') return 'destructive';
	if (role === 'admin') return 'default';
	return 'secondary';
}

export function UsersTable({ users }: { users: User[] }) {
	const queryClient = useQueryClient();
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [editUser, setEditUser] = useState<User | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: string) => trpcClient.users.delete.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.users.list.queryOptions().queryKey });
			setDeleteId(null);
		},
	});

	return (
		<>
			<div className="overflow-x-auto rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Role</TableHead>
							<TableHead className="hidden md:table-cell">Created</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{users.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-muted-foreground py-8">
									No users yet
								</TableCell>
							</TableRow>
						)}
						{users.map((u) => (
							<TableRow key={u.id}>
								<TableCell className="font-medium">{u.name}</TableCell>
								<TableCell className="text-sm">{u.email}</TableCell>
								<TableCell>
									<Badge variant={roleVariant(u.role)}>{u.role}</Badge>
								</TableCell>
								<TableCell className="hidden md:table-cell text-sm text-muted-foreground">
									{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
								</TableCell>
								<TableCell>
									{u.role === 'superadmin' ? (
										<span className="text-xs text-muted-foreground">Manage via CLI</span>
									) : (
										<div className="flex gap-1">
											<button
												type="button"
												onClick={() => setEditUser(u)}
												className="p-1 text-muted-foreground hover:text-foreground"
											>
												<Pencil className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={() => setDeleteId(u.id)}
												className="p-1 text-muted-foreground hover:text-destructive"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										</div>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete User</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this user account. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteId && deleteMutation.mutate(deleteId)}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{editUser && (
				<UserFormDialog
					open={true}
					onOpenChange={(open) => !open && setEditUser(null)}
					user={editUser}
				/>
			)}
		</>
	);
}
