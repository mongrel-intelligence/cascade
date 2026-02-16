import { Button } from '@/components/ui/button.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

interface DebugAnalysisProps {
	runId: string;
}

function Section({ title, content }: { title: string; content: string | null | undefined }) {
	if (!content) return null;
	return (
		<div className="rounded-lg border border-border p-4">
			<h3 className="mb-2 text-sm font-semibold">{title}</h3>
			<pre className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</pre>
		</div>
	);
}

export function DebugAnalysis({ runId }: DebugAnalysisProps) {
	const queryClient = useQueryClient();
	const prevStatusRef = useRef<string | undefined>(undefined);

	const analysisQuery = useQuery(trpc.runs.getDebugAnalysis.queryOptions({ runId }));

	const statusQuery = useQuery({
		...trpc.runs.getDebugAnalysisStatus.queryOptions({ runId }),
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === 'running' ? 5000 : false;
		},
	});

	const triggerMutation = useMutation({
		mutationFn: () => trpcClient.runs.triggerDebugAnalysis.mutate({ runId }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getDebugAnalysisStatus.queryOptions({ runId }).queryKey,
			});
		},
	});

	// When status transitions from running → completed, refetch the analysis
	useEffect(() => {
		const currentStatus = statusQuery.data?.status;
		if (prevStatusRef.current === 'running' && currentStatus === 'completed') {
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getDebugAnalysis.queryOptions({ runId }).queryKey,
			});
		}
		prevStatusRef.current = currentStatus;
	}, [statusQuery.data?.status, queryClient, runId]);

	const isRunning = triggerMutation.isPending || statusQuery.data?.status === 'running';

	if (analysisQuery.isLoading || statusQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading analysis...</div>;
	}

	if (isRunning) {
		return (
			<div className="py-8 text-center text-muted-foreground">Debug analysis is running...</div>
		);
	}

	if (!analysisQuery.data) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<p className="text-muted-foreground">No debug analysis available for this run</p>
				<Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
					Run Analysis
				</Button>
				{triggerMutation.isError && (
					<p className="text-sm text-destructive">
						{triggerMutation.error instanceof Error
							? triggerMutation.error.message
							: 'Failed to trigger analysis'}
					</p>
				)}
			</div>
		);
	}

	const analysis = analysisQuery.data;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{analysis.severity && (
						<>
							<span className="text-sm text-muted-foreground">Severity:</span>
							<span className="text-sm font-medium">{analysis.severity}</span>
						</>
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => triggerMutation.mutate()}
					disabled={triggerMutation.isPending}
				>
					Re-run Analysis
				</Button>
			</div>
			{triggerMutation.isError && (
				<p className="text-sm text-destructive">
					{triggerMutation.error instanceof Error
						? triggerMutation.error.message
						: 'Failed to trigger analysis'}
				</p>
			)}
			<Section title="Summary" content={analysis.summary} />
			<Section title="Issues" content={analysis.issues} />
			<Section title="Root Cause" content={analysis.rootCause} />
			<Section title="Timeline" content={analysis.timeline} />
			<Section title="Recommendations" content={analysis.recommendations} />
		</div>
	);
}
