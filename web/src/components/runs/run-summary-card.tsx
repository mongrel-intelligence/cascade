import { useElapsedTime } from '@/lib/useElapsedTime.js';
import { formatCost, formatDuration } from '@/lib/utils.js';
import { ExternalLink } from 'lucide-react';

interface RunSummaryProps {
	run: {
		id: string;
		projectId: string | null;
		cardId: string | null;
		prNumber: number | null;
		agentType: string;
		backend: string;
		triggerType: string | null;
		status: string;
		model: string | null;
		maxIterations: number | null;
		startedAt: string | null;
		completedAt: string | null;
		durationMs: number | null;
		llmIterations: number | null;
		gadgetCalls: number | null;
		costUsd: string | null;
		success: boolean | null;
		error: string | null;
		prUrl: string | null;
		outputSummary: string | null;
		workItemTitle?: string | null;
		workItemUrl?: string | null;
	};
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 text-sm font-medium">{children}</dd>
		</div>
	);
}

export function RunSummaryCard({ run }: RunSummaryProps) {
	const elapsed = useElapsedTime(run.startedAt, run.status === 'running');
	const displayDuration = elapsed ?? run.durationMs;

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				<Field label="Status">{run.status}</Field>
				<Field label="Backend">{run.backend}</Field>
				<Field label="Model">{run.model ?? '-'}</Field>
				<Field label="Trigger">{run.triggerType ?? '-'}</Field>
				<Field label="Duration">{formatDuration(displayDuration)}</Field>
				<Field label="Cost">{formatCost(run.costUsd)}</Field>
				<Field label="LLM Iterations">
					{run.llmIterations != null
						? `${run.llmIterations}${run.maxIterations ? ` / ${run.maxIterations}` : ''}`
						: '-'}
				</Field>
				<Field label="Gadget Calls">{run.gadgetCalls ?? '-'}</Field>
				<Field label="Started">
					{run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
				</Field>
				<Field label="Completed">
					{run.completedAt ? new Date(run.completedAt).toLocaleString() : '-'}
				</Field>
				<Field label="Work Item">
					{run.workItemUrl && run.workItemTitle ? (
						<a
							href={run.workItemUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-primary hover:underline"
						>
							{run.workItemTitle}
							<ExternalLink className="h-3 w-3" />
						</a>
					) : run.cardId ? (
						run.cardId
					) : (
						'-'
					)}
				</Field>
				{run.prUrl && (
					<Field label="Pull Request">
						<a
							href={run.prUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-primary hover:underline"
						>
							PR #{run.prNumber ?? 'link'}
							<ExternalLink className="h-3 w-3" />
						</a>
					</Field>
				)}
			</div>

			{run.error && (
				<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
					<h3 className="mb-1 text-sm font-medium text-destructive">Error</h3>
					<pre className="overflow-x-auto whitespace-pre-wrap text-sm">{run.error}</pre>
				</div>
			)}

			{run.outputSummary && (
				<div className="rounded-lg border border-border p-4">
					<h3 className="mb-1 text-sm font-medium">Output Summary</h3>
					<pre className="overflow-x-auto whitespace-pre-wrap text-sm text-muted-foreground">
						{run.outputSummary}
					</pre>
				</div>
			)}
		</div>
	);
}
