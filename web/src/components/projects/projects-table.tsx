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
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

interface Project {
	id: string;
	name: string;
	repo?: string | null;
	baseBranch: string | null;
	agentBackend: string | null;
	workItemBudgetUsd: string | null;
}

export function ProjectsTable({ projects }: { projects: Project[] }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: string) => trpcClient.projects.delete.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
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
							<TableHead>Repo</TableHead>
							<TableHead className="hidden md:table-cell">Base Branch</TableHead>
							<TableHead className="hidden md:table-cell">Backend</TableHead>
							<TableHead className="hidden md:table-cell text-right">Budget</TableHead>
							<TableHead className="w-10" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{projects.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									No projects yet
								</TableCell>
							</TableRow>
						)}
						{projects.map((project) => (
							<TableRow
								key={project.id}
								className="cursor-pointer"
								onClick={() =>
									navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
								}
							>
								<TableCell className="font-medium">{project.name}</TableCell>
								<TableCell className="text-muted-foreground font-mono text-xs">
									{project.repo || '-'}
								</TableCell>
								<TableCell className="hidden md:table-cell">
									<Badge variant="outline">{project.baseBranch ?? 'main'}</Badge>
								</TableCell>
								<TableCell className="hidden md:table-cell">
									{project.agentBackend ?? 'llmist'}
								</TableCell>
								<TableCell className="hidden md:table-cell text-right tabular-nums">
									{project.workItemBudgetUsd ? `$${project.workItemBudgetUsd}` : '-'}
								</TableCell>
								<TableCell>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											setDeleteId(project.id);
										}}
										className="p-1 text-muted-foreground hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Project</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this project and all its integrations, credential
							overrides, and agent configs. This action cannot be undone.
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
		</>
	);
}
