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
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AgentDefinitionFormDialog } from './agent-definition-form.js';

interface AgentDefinition {
	identity: {
		emoji: string;
		label: string;
		roleHint: string;
		initialMessage: string;
	};
	capabilities: {
		canEditFiles: boolean;
		canCreatePR: boolean;
		canUpdateChecklists: boolean;
		isReadOnly: boolean;
		canAccessEmail?: boolean;
	};
	tools: {
		sets: string[];
		sdkTools: string;
	};
	strategies: {
		contextPipeline: string[];
		taskPromptBuilder: string;
		gadgetBuilder: string;
		gadgetBuilderOptions?: { includeReviewComments?: boolean } | null;
	};
	backend: {
		enableStopHooks: boolean;
		needsGitHubToken: boolean;
		blockGitPush?: boolean;
		requiresPR?: boolean;
		preExecute?: string;
		postConfigure?: string;
	};
	compaction: string;
	hint: string;
	trailingMessage?: {
		includeDiagnostics?: boolean;
		includeTodoProgress?: boolean;
		includeGitStatus?: boolean;
		includePRStatus?: boolean;
		includeReminder?: boolean;
	} | null;
	integrations: {
		required: string[];
		optional: string[];
	};
}

interface DefinitionRow {
	agentType: string;
	definition: AgentDefinition;
	isBuiltin: boolean;
}

export function AgentDefinitionsTable({ definitions }: { definitions: DefinitionRow[] }) {
	const queryClient = useQueryClient();
	const [editDef, setEditDef] = useState<DefinitionRow | null>(null);

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
		<>
			<div className="overflow-hidden rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Emoji</TableHead>
							<TableHead>Agent Type</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Capabilities</TableHead>
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
						{definitions.map((row) => (
							<TableRow key={row.agentType}>
								<TableCell className="text-lg">{row.definition.identity.emoji}</TableCell>
								<TableCell className="font-medium font-mono text-sm">{row.agentType}</TableCell>
								<TableCell>{row.definition.identity.label}</TableCell>
								<TableCell>
									<div className="flex flex-wrap gap-1">
										{row.definition.capabilities.canEditFiles && (
											<Badge variant="secondary" className="text-xs">
												edit files
											</Badge>
										)}
										{row.definition.capabilities.canCreatePR && (
											<Badge variant="secondary" className="text-xs">
												create PR
											</Badge>
										)}
										{row.definition.capabilities.canUpdateChecklists && (
											<Badge variant="secondary" className="text-xs">
												checklists
											</Badge>
										)}
										{row.definition.capabilities.isReadOnly && (
											<Badge variant="outline" className="text-xs">
												read-only
											</Badge>
										)}
										{row.definition.capabilities.canAccessEmail && (
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
											onClick={() => setEditDef(row)}
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
						))}
					</TableBody>
				</Table>
			</div>

			{editDef && (
				<AgentDefinitionFormDialog
					open={true}
					onOpenChange={(open) => !open && setEditDef(null)}
					existing={editDef}
				/>
			)}
		</>
	);
}
