import { Badge } from '@/components/ui/badge.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

interface PromptEditorProps {
	target: { name: string };
	onClose: () => void;
}

export function PromptEditor({ target, onClose }: PromptEditorProps) {
	return <PartialEditor name={target.name} onClose={onClose} />;
}

function PartialEditor({ name, onClose }: { name: string; onClose: () => void }) {
	const queryClient = useQueryClient();
	const [content, setContent] = useState('');
	const [validationStatus, setValidationStatus] = useState<string | null>(null);

	const partialQuery = useQuery(trpc.prompts.getPartial.queryOptions({ name }));
	const defaultQuery = useQuery(trpc.prompts.getDefaultPartial.queryOptions({ name }));

	const isCustom = partialQuery.data?.source === 'db';

	useEffect(() => {
		if (partialQuery.data) {
			setContent(partialQuery.data.content);
		}
	}, [partialQuery.data]);

	const saveMutation = useMutation({
		mutationFn: () => trpcClient.prompts.upsertPartial.mutate({ name, content }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.listPartials.queryOptions().queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.getPartial.queryOptions({ name }).queryKey,
			});
			setValidationStatus('Saved.');
		},
	});

	const resetMutation = useMutation({
		mutationFn: async () => {
			const data = partialQuery.data;
			if (data && 'id' in data && data.id != null) {
				await trpcClient.prompts.deletePartial.mutate({ id: data.id });
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.listPartials.queryOptions().queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.prompts.getPartial.queryOptions({ name }).queryKey,
			});
			if (defaultQuery.data) {
				setContent(defaultQuery.data.content);
			}
			setValidationStatus('Reset to disk default.');
		},
	});

	function loadDefault() {
		if (defaultQuery.data) {
			setContent(defaultQuery.data.content);
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="text-xl font-bold">
					Partial: {name}
					{isCustom && <Badge className="ml-2">custom</Badge>}
				</h2>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => resetMutation.mutate()}
						disabled={!isCustom || resetMutation.isPending}
						className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
					>
						Reset to Default
					</button>
					<button
						type="button"
						onClick={() => saveMutation.mutate()}
						disabled={saveMutation.isPending}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{saveMutation.isPending ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>

			<textarea
				value={content}
				onChange={(e) => {
					setContent(e.target.value);
					setValidationStatus(null);
				}}
				className="w-full h-[500px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
				spellCheck={false}
			/>
			<div className="flex items-center gap-4">
				<button
					type="button"
					onClick={loadDefault}
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					Load Default
				</button>
				{validationStatus && (
					<span
						className={`text-sm ${
							validationStatus.startsWith('Invalid')
								? 'text-destructive'
								: 'text-green-600 dark:text-green-400'
						}`}
					>
						{validationStatus}
					</span>
				)}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}

export function ReferencePanel({
	variables,
	partials,
}: {
	variables?: Array<{ name: string; group: string; description: string }>;
	partials?: Array<{ name: string; source: string; lines: number }>;
}) {
	const [varsExpanded, setVarsExpanded] = useState(true);
	const [partialsExpanded, setPartialsExpanded] = useState(true);

	const groups = new Map<string, typeof variables>();
	if (variables) {
		for (const v of variables) {
			const existing = groups.get(v.group) ?? [];
			existing.push(v);
			groups.set(v.group, existing);
		}
	}

	return (
		<div className="space-y-4 text-sm">
			<h3 className="font-semibold">Reference</h3>

			<div>
				<button
					type="button"
					onClick={() => setVarsExpanded(!varsExpanded)}
					className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
				>
					{varsExpanded ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
					Variables
				</button>
				{varsExpanded && (
					<div className="mt-2 space-y-3 pl-5">
						{[...groups.entries()].map(([group, vars]) => (
							<div key={group}>
								<div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
									{group}
								</div>
								{vars?.map((v) => (
									<div key={v.name} className="py-1">
										<code className="text-xs bg-muted px-1 rounded">{`<%= it.${v.name} %>`}</code>
										<p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</div>

			<div>
				<button
					type="button"
					onClick={() => setPartialsExpanded(!partialsExpanded)}
					className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
				>
					{partialsExpanded ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
					Partials
				</button>
				{partialsExpanded && (
					<div className="mt-2 space-y-1 pl-5">
						{partials?.map((p) => (
							<div key={p.name} className="flex items-center justify-between py-0.5">
								<code className="text-xs bg-muted px-1 rounded">{p.name}</code>
								<span className="text-xs text-muted-foreground">
									{p.lines}L
									{p.source === 'db' && (
										<Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">
											db
										</Badge>
									)}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
