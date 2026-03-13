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
import { AgentConfigFormDialog } from './agent-config-form-dialog.js';

export interface AgentConfig {
	id: number;
	orgId: string | null;
	projectId: string | null;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	maxConcurrency: number | null;
}

export function AgentConfigsTable({
	configs,
	isGlobalScope = false,
}: { configs: AgentConfig[]; isGlobalScope?: boolean }) {
	const queryClient = useQueryClient();
	const [editConfig, setEditConfig] = useState<AgentConfig | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => {
			if (isGlobalScope) {
				queryClient.invalidateQueries({
					queryKey: trpc.agentConfigs.listGlobal.queryOptions().queryKey,
				});
			} else {
				queryClient.invalidateQueries({ queryKey: trpc.agentConfigs.list.queryOptions().queryKey });
			}
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
							<TableHead>Scope</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{configs.length === 0 && (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
								<TableCell className="hidden md:table-cell">{config.agentEngine ?? '-'}</TableCell>
								<TableCell>
									{config.projectId ? (
										<Badge variant="outline">Project</Badge>
									) : config.orgId ? (
										<Badge variant="secondary">Org</Badge>
									) : (
										<Badge variant="default">Global</Badge>
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
											onClick={() => {
												if (window.confirm('Delete this agent config?')) {
													deleteMutation.mutate(config.id);
												}
											}}
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

			{editConfig && (
				<AgentConfigFormDialog
					open={true}
					onOpenChange={(open) => !open && setEditConfig(null)}
					config={editConfig}
					isGlobalScope={isGlobalScope}
				/>
			)}
		</>
	);
}
