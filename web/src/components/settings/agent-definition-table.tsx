import type { AppRouter } from '@/../../src/api/router.js';
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
import type { inferRouterOutputs } from '@trpc/server';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';

type RouterOutput = inferRouterOutputs<AppRouter>;
type DefinitionRow = RouterOutput['agentDefinitions']['list'][number];

export type { DefinitionRow };

// Helper to derive key capability indicators from the capability arrays
function getCapabilityIndicators(capabilities: DefinitionRow['definition']['capabilities']) {
	const all = [...capabilities.required, ...capabilities.optional];
	return {
		canEditFiles: all.includes('fs:write'),
		canCreatePR: all.includes('scm:pr'),
		hasChecklists: all.includes('pm:checklist'),
		isReadOnly: !all.includes('fs:write'),
		hasEmail: false, // email capabilities removed
	};
}

export function AgentDefinitionsTable({
	definitions,
	onEdit,
}: {
	definitions: DefinitionRow[];
	onEdit: (def: DefinitionRow) => void;
}) {
	const queryClient = useQueryClient();

	const queryKey = trpc.agentDefinitions.list.queryOptions().queryKey;

	const deleteMutation = useMutation({
		mutationFn: (agentType: string) => trpcClient.agentDefinitions.delete.mutate({ agentType }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const resetMutation = useMutation({
		mutationFn: (agentType: string) => trpcClient.agentDefinitions.reset.mutate({ agentType }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="hidden md:table-cell">Emoji</TableHead>
						<TableHead>Agent Type</TableHead>
						<TableHead>Label</TableHead>
						<TableHead className="hidden md:table-cell">Capabilities</TableHead>
						<TableHead>Type</TableHead>
						<TableHead className="w-24" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{definitions.length === 0 && (
						<TableRow>
							<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
								No agent definitions found
							</TableCell>
						</TableRow>
					)}
					{definitions.map((row) => {
						const caps = getCapabilityIndicators(row.definition.capabilities);
						return (
							<TableRow key={row.agentType}>
								<TableCell className="hidden md:table-cell text-lg">
									{row.definition.identity.emoji}
								</TableCell>
								<TableCell className="font-medium font-mono text-sm">{row.agentType}</TableCell>
								<TableCell>{row.definition.identity.label}</TableCell>
								<TableCell className="hidden md:table-cell">
									<div className="flex flex-wrap gap-1">
										{caps.canEditFiles && (
											<Badge variant="secondary" className="text-xs">
												edit files
											</Badge>
										)}
										{caps.canCreatePR && (
											<Badge variant="secondary" className="text-xs">
												create PR
											</Badge>
										)}
										{caps.hasChecklists && (
											<Badge variant="secondary" className="text-xs">
												checklists
											</Badge>
										)}
										{caps.isReadOnly && (
											<Badge variant="outline" className="text-xs">
												read-only
											</Badge>
										)}
										{caps.hasEmail && (
											<Badge variant="secondary" className="text-xs">
												email
											</Badge>
										)}
									</div>
								</TableCell>
								<TableCell>
									{row.isBuiltin ? (
										<Badge variant="default">Built-in</Badge>
									) : (
										<Badge variant="outline">Custom</Badge>
									)}
								</TableCell>
								<TableCell>
									<div className="flex gap-1">
										<button
											type="button"
											onClick={() => onEdit(row)}
											className="p-1 text-muted-foreground hover:text-foreground"
											title="Edit definition"
										>
											<Pencil className="h-4 w-4" />
										</button>
										{row.isBuiltin && (
											<button
												type="button"
												onClick={() => {
													if (confirm(`Reset "${row.agentType}" to its built-in default?`)) {
														resetMutation.mutate(row.agentType);
													}
												}}
												className="p-1 text-muted-foreground hover:text-foreground"
												title="Reset to default"
												disabled={resetMutation.isPending}
											>
												<RotateCcw className="h-4 w-4" />
											</button>
										)}
										{!row.isBuiltin && (
											<button
												type="button"
												onClick={() => {
													if (confirm(`Delete custom definition "${row.agentType}"?`)) {
														deleteMutation.mutate(row.agentType);
													}
												}}
												className="p-1 text-muted-foreground hover:text-destructive"
												title="Delete definition"
												disabled={deleteMutation.isPending}
											>
												<Trash2 className="h-4 w-4" />
											</button>
										)}
									</div>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
