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
import { CredentialFormDialog } from './credential-form-dialog.js';

interface Credential {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
	isDefault: boolean;
}

export function CredentialsTable({ credentials }: { credentials: Credential[] }) {
	const queryClient = useQueryClient();
	const [deleteId, setDeleteId] = useState<number | null>(null);
	const [editCredential, setEditCredential] = useState<Credential | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.credentials.delete.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.credentials.list.queryOptions().queryKey });
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
							<TableHead>Env Var Key</TableHead>
							<TableHead className="hidden md:table-cell">Value</TableHead>
							<TableHead>Default</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{credentials.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-muted-foreground py-8">
									No credentials yet
								</TableCell>
							</TableRow>
						)}
						{credentials.map((cred) => (
							<TableRow key={cred.id}>
								<TableCell className="font-medium">{cred.name}</TableCell>
								<TableCell className="font-mono text-xs">{cred.envVarKey}</TableCell>
								<TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
									{cred.value}
								</TableCell>
								<TableCell>
									{cred.isDefault && <Badge variant="secondary">Default</Badge>}
								</TableCell>
								<TableCell>
									<div className="flex gap-1">
										<button
											type="button"
											onClick={() => setEditCredential(cred)}
											className="p-1 text-muted-foreground hover:text-foreground"
										>
											<Pencil className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() => setDeleteId(cred.id)}
											className="p-1 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Credential</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this credential and any project overrides referencing it.
							This action cannot be undone.
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

			{editCredential && (
				<CredentialFormDialog
					open={true}
					onOpenChange={(open) => !open && setEditCredential(null)}
					credential={editCredential}
				/>
			)}
		</>
	);
}
