import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { AgentConfigFormDialog } from './agent-config-form-dialog.js';

export interface AgentConfig {
	id: number;
	projectId: string;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	agentEngineSettings: Record<string, Record<string, unknown>> | null;
	maxConcurrency: number | null;
}

export function AgentConfigsTable({ configs }: { configs: AgentConfig[] }) {
	const queryClient = useQueryClient();
	const [editConfig, setEditConfig] = useState<AgentConfig | null>(null);
	const [deleteConfigId, setDeleteConfigId] = useState<number | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.agentConfigs.list.queryOptions({ projectId: configs[0]?.projectId ?? '' })
					.queryKey,
			});
			setDeleteConfigId(null);
		},
	});

	return (
		<>
			<div className="overflow-x-auto rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Agent Type</TableHead>
							<TableHead>Model</TableHead>
							<TableHead className="hidden md:table-cell">Max Iterations</TableHead>
							<TableHead className="hidden md:table-cell">Max Concurrency</TableHead>
							<TableHead className="hidden md:table-cell">Engine</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{configs.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									No agent configs yet
								</TableCell>
							</TableRow>
						)}
						{configs.map((config) => (
							<TableRow key={config.id}>
								<TableCell className="font-medium">{config.agentType}</TableCell>
								<TableCell>{config.model ?? '-'}</TableCell>
								<TableCell className="hidden md:table-cell">
									{config.maxIterations ?? '-'}
								</TableCell>
								<TableCell className="hidden md:table-cell">
									{config.maxConcurrency ?? '-'}
								</TableCell>
								<TableCell className="hidden md:table-cell">
									<span>{config.agentEngine ?? '-'}</span>
									{config.agentEngineSettings &&
										Object.keys(config.agentEngineSettings).length > 0 && (
											<span className="ml-2 inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
												Custom
											</span>
										)}
								</TableCell>
								<TableCell>
									<div className="flex gap-1">
										<button
											type="button"
											onClick={() => setEditConfig(config)}
											className="p-1 text-muted-foreground hover:text-foreground"
										>
											<Pencil className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() => setDeleteConfigId(config.id)}
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

			<AlertDialog
				open={!!deleteConfigId}
				onOpenChange={(open) => !open && setDeleteConfigId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Agent Config</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this agent configuration? This action cannot be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteConfigId && deleteMutation.mutate(deleteConfigId)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{editConfig && (
				<AgentConfigFormDialog
					open={true}
					onOpenChange={(open) => !open && setEditConfig(null)}
					config={editConfig}
				/>
			)}
		</>
	);
}
