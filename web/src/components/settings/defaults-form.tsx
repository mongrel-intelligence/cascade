import { ModelField } from '@/components/settings/model-field.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function DefaultsForm() {
	const queryClient = useQueryClient();
	const defaultsQuery = useQuery(trpc.defaults.get.queryOptions());

	const [model, setModel] = useState('');
	const [maxIterations, setMaxIterations] = useState('');
	const [watchdogTimeoutMs, setWatchdogTimeoutMs] = useState('');
	const [cardBudgetUsd, setCardBudgetUsd] = useState('');
	const [agentBackend, setAgentBackend] = useState('');
	const [progressModel, setProgressModel] = useState('');
	const [progressIntervalMinutes, setProgressIntervalMinutes] = useState('');

	useEffect(() => {
		if (defaultsQuery.data) {
			const d = defaultsQuery.data;
			setModel(d.model ?? '');
			setMaxIterations(d.maxIterations?.toString() ?? '');
			setWatchdogTimeoutMs(d.watchdogTimeoutMs?.toString() ?? '');
			setCardBudgetUsd(d.cardBudgetUsd ?? '');
			setAgentBackend(d.agentBackend ?? '');
			setProgressModel(d.progressModel ?? '');
			setProgressIntervalMinutes(d.progressIntervalMinutes ?? '');
		}
	}, [defaultsQuery.data]);

	const upsertMutation = useMutation({
		mutationFn: () =>
			trpcClient.defaults.upsert.mutate({
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				watchdogTimeoutMs: watchdogTimeoutMs ? Number(watchdogTimeoutMs) : null,
				cardBudgetUsd: cardBudgetUsd || null,
				agentBackend: agentBackend || null,
				progressModel: progressModel || null,
				progressIntervalMinutes: progressIntervalMinutes || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.defaults.get.queryOptions().queryKey });
		},
	});

	if (defaultsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading defaults...</div>;
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				upsertMutation.mutate();
			}}
			className="max-w-2xl space-y-4"
		>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="d-model">Model</Label>
					<ModelField id="d-model" value={model} onChange={setModel} backend={agentBackend} />
				</div>
				<div className="space-y-2">
					<Label htmlFor="d-iterations">Max Iterations</Label>
					<Input
						id="d-iterations"
						type="number"
						value={maxIterations}
						onChange={(e) => setMaxIterations(e.target.value)}
						placeholder="e.g. 20"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="d-watchdog">Watchdog Timeout (ms)</Label>
					<Input
						id="d-watchdog"
						type="number"
						value={watchdogTimeoutMs}
						onChange={(e) => setWatchdogTimeoutMs(e.target.value)}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="d-budget">Card Budget (USD)</Label>
					<Input
						id="d-budget"
						value={cardBudgetUsd}
						onChange={(e) => setCardBudgetUsd(e.target.value)}
						placeholder="e.g. 2.00"
					/>
				</div>
				<div className="space-y-2">
					<Label>Agent Backend</Label>
					<Select
						value={agentBackend || '_none'}
						onValueChange={(v) => setAgentBackend(v === '_none' ? '' : v)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select backend" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="_none">None</SelectItem>
							<SelectItem value="llmist">llmist</SelectItem>
							<SelectItem value="claude-code">claude-code</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="d-progressModel">Progress Model</Label>
					<Input
						id="d-progressModel"
						value={progressModel}
						onChange={(e) => setProgressModel(e.target.value)}
						placeholder="e.g. claude-haiku-3-20240307"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="d-progressInterval">Progress Interval (minutes)</Label>
					<Input
						id="d-progressInterval"
						value={progressIntervalMinutes}
						onChange={(e) => setProgressIntervalMinutes(e.target.value)}
						placeholder="e.g. 5"
					/>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="submit"
					disabled={upsertMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{upsertMutation.isPending ? 'Saving...' : 'Save Defaults'}
				</button>
				{upsertMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{upsertMutation.isError && (
					<span className="text-sm text-destructive">{upsertMutation.error.message}</span>
				)}
			</div>
		</form>
	);
}
