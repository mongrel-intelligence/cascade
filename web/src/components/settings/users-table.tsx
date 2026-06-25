import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, UserMinus } from 'lucide-react';
import { useState } from 'react';
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
import { UserFormDialog } from './user-form-dialog.js';

interface User {
	id: string;
	orgId: string;
	name: string;
	email: string;
	/** Per-org membership role (spec 021 plan 3). */
	role: string;
	/**
	 * Global account role (`users.role`). The role column + CLI guard + editor
	 * target this column because `users.update` still writes the global role;
	 * per-org role rendering lands with the plan-4 UI (PR #1441 review).
	 */
	globalRole: string;
	/**
	 * True when the account's home org is elsewhere — a "guest" granted membership
	 * via add-to-org. Guests get "Remove from this org" (drops only the membership)
	 * instead of "Delete account" (removes the whole account across every org).
	 */
	isGuest?: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

export function roleVariant(role: string): 'default' | 'secondary' | 'destructive' | 'outline' {
	if (role === 'superadmin') return 'destructive';
	if (role === 'admin') return 'default';
	return 'secondary';
}

/**
 * Display model for one membership row (spec 021 plan 4, AC #5). Surfaces BOTH
 * roles the listing returns:
 *  - `accountRole` — the global `users.role`; this is the column the editor still
 *    reads/writes (`users.update`).
 *  - `orgRole` — the PER-ORG membership role, rendered alongside so an admin can
 *    see a member's standing in *this* org even when it differs from the account
 *    role.
 *
 * `isGuest` marks an account whose home org is elsewhere (a cross-home member
 * granted via add-to-org); `manageViaCli` flags global superadmins, whose
 * accounts are intentionally not editable from the dashboard.
 */
export interface MemberRowSummary {
	accountRole: string;
	orgRole: string;
	isGuest: boolean;
	manageViaCli: boolean;
}

export function describeMemberRow(member: {
	role: string;
	globalRole: string;
	isGuest?: boolean;
}): MemberRowSummary {
	return {
		accountRole: member.globalRole,
		orgRole: member.role,
		isGuest: member.isGuest ?? false,
		manageViaCli: member.globalRole === 'superadmin',
	};
}

export function UsersTable({ users }: { users: User[] }) {
	const queryClient = useQueryClient();
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [removeFromOrgId, setRemoveFromOrgId] = useState<string | null>(null);
	const [editUser, setEditUser] = useState<User | null>(null);

	const invalidateList = () =>
		queryClient.invalidateQueries({ queryKey: trpc.users.list.queryOptions().queryKey });

	const deleteMutation = useMutation({
		mutationFn: (id: string) => trpcClient.users.delete.mutate({ id }),
		onSuccess: () => {
			invalidateList();
			setDeleteId(null);
		},
	});

	const removeFromOrgMutation = useMutation({
		mutationFn: (userId: string) => trpcClient.users.removeFromOrg.mutate({ userId }),
		onSuccess: () => {
			invalidateList();
			setRemoveFromOrgId(null);
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
							<TableHead>Account</TableHead>
							<TableHead>Org role</TableHead>
							<TableHead className="hidden md:table-cell">Created</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{users.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									No members yet
								</TableCell>
							</TableRow>
						)}
						{users.map((u) => {
							const summary = describeMemberRow(u);
							return (
								<TableRow key={u.id}>
									<TableCell className="font-medium">
										<div className="flex items-center gap-2">
											<span className="truncate">{u.name}</span>
											{summary.isGuest && (
												<Badge
													variant="outline"
													className="text-[10px] font-normal"
													title="This account's home organization is elsewhere"
												>
													Guest
												</Badge>
											)}
										</div>
									</TableCell>
									<TableCell className="text-sm">{u.email}</TableCell>
									<TableCell>
										<Badge variant={roleVariant(summary.accountRole)}>{summary.accountRole}</Badge>
									</TableCell>
									<TableCell>
										<Badge variant="outline">{summary.orgRole}</Badge>
									</TableCell>
									<TableCell className="hidden md:table-cell text-sm text-muted-foreground">
										{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
									</TableCell>
									<TableCell>
										{summary.manageViaCli ? (
											<span className="text-xs text-muted-foreground">Manage via CLI</span>
										) : (
											<div className="flex gap-1">
												<button
													type="button"
													onClick={() => setEditUser(u)}
													className="p-1 text-muted-foreground hover:text-foreground"
													title="Edit user"
												>
													<Pencil className="h-4 w-4" />
												</button>
												{u.isGuest ? (
													<button
														type="button"
														onClick={() => setRemoveFromOrgId(u.id)}
														className="p-1 text-muted-foreground hover:text-destructive"
														title="Remove from this organization"
													>
														<UserMinus className="h-4 w-4" />
													</button>
												) : (
													<button
														type="button"
														onClick={() => setDeleteId(u.id)}
														className="p-1 text-muted-foreground hover:text-destructive"
														title="Delete account"
													>
														<Trash2 className="h-4 w-4" />
													</button>
												)}
											</div>
										)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete User</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this user account across every organization. This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteId && deleteMutation.mutate(deleteId)}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={!!removeFromOrgId}
				onOpenChange={(open) => !open && setRemoveFromOrgId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove from organization</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the user’s access to this organization only. Their account and membership
							in other organizations are unaffected.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => removeFromOrgId && removeFromOrgMutation.mutate(removeFromOrgId)}
							variant="destructive"
						>
							Remove
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
