import { Button } from '@/components/ui/button.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
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
import { useState } from 'react';

const agentTypes = [
	'briefing',
	'planning',
	'implementation',
	'review',
	'debug',
	'respond-to-review',
	'respond-to-pr-comment',
];

interface TriggerRunDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function TriggerRunDialog({ open, onOpenChange }: TriggerRunDialogProps) {
	const queryClient = useQueryClient();

	const [projectId, setProjectId] = useState('');
	const [agentType, setAgentType] = useState('');
	const [cardId, setCardId] = useState('');
	const [prNumber, setPrNumber] = useState('');
	const [prBranch, setPrBranch] = useState('');
	const [model, setModel] = useState('');

	const projectsQuery = useQuery(trpc.projects.list.queryOptions());

	const runsQueryKey = trpc.runs.list.queryOptions({}).queryKey;

	const triggerMutation = useMutation({
		mutationFn: () =>
			trpcClient.runs.trigger.mutate({
				projectId,
				agentType,
				cardId: cardId || undefined,
				prNumber: prNumber ? Number(prNumber) : undefined,
				prBranch: prBranch || undefined,
				model: model || undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: runsQueryKey });
			onOpenChange(false);
			// Reset form
			setProjectId('');
			setAgentType('');
			setCardId('');
			setPrNumber('');
			setPrBranch('');
			setModel('');
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Trigger Run</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						triggerMutation.mutate();
					}}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="tr-project">Project</Label>
						<Select
							value={projectId || '_none'}
							onValueChange={(v) => setProjectId(v === '_none' ? '' : v)}
						>
							<SelectTrigger className="w-full" id="tr-project">
								<SelectValue placeholder="Select project" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none">Select project</SelectItem>
								{projectsQuery.data?.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="tr-agentType">Agent Type</Label>
						<Select
							value={agentType || '_none'}
							onValueChange={(v) => setAgentType(v === '_none' ? '' : v)}
						>
							<SelectTrigger className="w-full" id="tr-agentType">
								<SelectValue placeholder="Select agent type" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none">Select agent type</SelectItem>
								{agentTypes.map((t) => (
									<SelectItem key={t} value={t}>
										{t}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="tr-cardId">Card ID (optional)</Label>
						<Input
							id="tr-cardId"
							value={cardId}
							onChange={(e) => setCardId(e.target.value)}
							placeholder="Trello card ID"
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="tr-prNumber">PR Number (optional)</Label>
							<Input
								id="tr-prNumber"
								type="number"
								value={prNumber}
								onChange={(e) => setPrNumber(e.target.value)}
								placeholder="e.g. 42"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="tr-prBranch">PR Branch (optional)</Label>
							<Input
								id="tr-prBranch"
								value={prBranch}
								onChange={(e) => setPrBranch(e.target.value)}
								placeholder="e.g. feature/my-branch"
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="tr-model">Model (optional)</Label>
						<Input
							id="tr-model"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="e.g. claude-opus-4-5-20250929"
						/>
					</div>

					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<Button type="submit" disabled={triggerMutation.isPending || !projectId || !agentType}>
							{triggerMutation.isPending ? 'Triggering...' : 'Trigger Run'}
						</Button>
					</div>

					{triggerMutation.isError && (
						<p className="text-sm text-destructive">
							{triggerMutation.error instanceof Error
								? triggerMutation.error.message
								: 'Failed to trigger run'}
						</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
