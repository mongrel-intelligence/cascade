import { PromptEditor } from '@/components/settings/prompt-editor.js';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

type EditTarget = { type: 'template'; agentType: string } | { type: 'partial'; name: string };

function PromptsPage() {
	const [tab, setTab] = useState<'templates' | 'partials'>('templates');
	const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

	if (editTarget) {
		return (
			<div className="space-y-4">
				<button
					type="button"
					onClick={() => setEditTarget(null)}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" /> Back to Prompts
				</button>
				<PromptEditor target={editTarget} onClose={() => setEditTarget(null)} />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
				<p className="text-sm text-muted-foreground">
					Manage agent system prompts and reusable partials.
				</p>
			</div>

			<div className="flex gap-2 border-b border-border">
				<button
					type="button"
					onClick={() => setTab('templates')}
					className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
						tab === 'templates'
							? 'border-primary text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					}`}
				>
					Templates
				</button>
				<button
					type="button"
					onClick={() => setTab('partials')}
					className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
						tab === 'partials'
							? 'border-primary text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					}`}
				>
					Partials
				</button>
			</div>

			{tab === 'templates' ? (
				<TemplatesTab onEdit={(agentType) => setEditTarget({ type: 'template', agentType })} />
			) : (
				<PartialsTab onEdit={(name) => setEditTarget({ type: 'partial', name })} />
			)}
		</div>
	);
}

function TemplatesTab({ onEdit }: { onEdit: (agentType: string) => void }) {
	const agentTypesQuery = useQuery(trpc.prompts.agentTypes.queryOptions());
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions());

	if (agentTypesQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading...</div>;
	}

	const agentTypes = agentTypesQuery.data ?? [];
	const configs = (configsQuery.data ?? []) as Array<{
		agentType: string;
		prompt: string | null;
	}>;
	const customPrompts = new Set(configs.filter((c) => c.prompt).map((c) => c.agentType));

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Agent Type</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="w-20" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{agentTypes.map((type) => (
						<TableRow key={type}>
							<TableCell className="font-medium">{type}</TableCell>
							<TableCell>
								{customPrompts.has(type) ? (
									<Badge>custom</Badge>
								) : (
									<Badge variant="outline">default</Badge>
								)}
							</TableCell>
							<TableCell>
								<button
									type="button"
									onClick={() => onEdit(type)}
									className="p-1 text-muted-foreground hover:text-foreground"
								>
									<Pencil className="h-4 w-4" />
								</button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function PartialsTab({ onEdit }: { onEdit: (name: string) => void }) {
	const queryClient = useQueryClient();
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.prompts.deletePartial.mutate({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.listPartials.queryOptions().queryKey,
			});
		},
	});

	if (partialsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading...</div>;
	}

	const partials = partialsQuery.data ?? [];

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Source</TableHead>
						<TableHead>Lines</TableHead>
						<TableHead className="w-20" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{partials.length === 0 && (
						<TableRow>
							<TableCell colSpan={4} className="text-center text-muted-foreground py-8">
								No partials found
							</TableCell>
						</TableRow>
					)}
					{partials.map((p) => (
						<TableRow key={p.name}>
							<TableCell className="font-medium">{p.name}</TableCell>
							<TableCell>
								{p.source === 'db' ? <Badge>custom</Badge> : <Badge variant="outline">disk</Badge>}
							</TableCell>
							<TableCell>{p.lines}</TableCell>
							<TableCell>
								<div className="flex gap-1">
									<button
										type="button"
										onClick={() => onEdit(p.name)}
										className="p-1 text-muted-foreground hover:text-foreground"
									>
										<Pencil className="h-4 w-4" />
									</button>
									{p.source === 'db' && p.id != null && (
										<button
											type="button"
											onClick={() => deleteMutation.mutate(p.id as number)}
											className="p-1 text-muted-foreground hover:text-destructive"
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
	);
}

export const settingsPromptsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/prompts',
	component: PromptsPage,
});
