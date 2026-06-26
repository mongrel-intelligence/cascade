import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button.js';
import {
	computeDebugAnalysisRunning,
	type DebugAnalysisStatus,
	debugAnalysisRefetchInterval,
	isTerminalDebugAnalysisStatus,
} from '@/lib/debug-analysis.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

interface DebugAnalysisProps {
	runId: string;
}

/** Minimal shape of the persisted debug-analysis content the panel renders. */
export interface DebugAnalysisContent {
	severity?: string | null;
	summary?: string | null;
	issues?: string | null;
	rootCause?: string | null;
	timeline?: string | null;
	recommendations?: string | null;
}

function Section({ title, content }: { title: string; content: string | null | undefined }) {
	if (!content) return null;
	return (
		<div className="rounded-lg border border-border p-4">
			<h3 className="mb-2 text-sm font-semibold">{title}</h3>
			<div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
				<ReactMarkdown>{content}</ReactMarkdown>
			</div>
		</div>
	);
}

/**
 * In-progress affordance shown while a debug analysis is running. Persists from
 * the moment the trigger is accepted until a terminal status, so the user always
 * has feedback that the (multi-minute) analysis is under way. Mirrors the
 * `RunPendingState` spinner styling.
 */
export function DebugAnalysisRunningIndicator() {
	return (
		<div
			className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
			role="status"
		>
			<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
			<span>Debug analysis is running… this can take a few minutes</span>
		</div>
	);
}

/** Failed-status + synchronous-trigger-error messaging, shared by both views. */
function DebugAnalysisErrors({
	status,
	isTriggerError,
	triggerError,
}: {
	status: DebugAnalysisStatus | undefined;
	isTriggerError: boolean;
	triggerError: unknown;
}) {
	return (
		<>
			{status === 'failed' && (
				<p className="text-sm text-destructive">
					Debug analysis failed. Please try running it again.
				</p>
			)}
			{isTriggerError && (
				<p className="text-sm text-destructive">
					{triggerError instanceof Error ? triggerError.message : 'Failed to trigger analysis'}
				</p>
			)}
		</>
	);
}

export interface DebugAnalysisViewProps {
	/** Latest analysis status; `undefined` before the first status read. */
	status: DebugAnalysisStatus | undefined;
	/** Whether the panel should show the in-progress affordance + disable buttons. */
	isRunning: boolean;
	/** The persisted analysis content row, or `null` when none exists yet. */
	analysis: DebugAnalysisContent | null;
	/** Whether the trigger mutation settled in an error state. */
	isTriggerError: boolean;
	/** Synchronous trigger error (CONFLICT / validation), or `null`. */
	triggerError: unknown;
	/** Invoked when the user presses Run / Re-run. */
	onTrigger: () => void;
}

/**
 * Presentational body of the Debug Analysis panel. Pure (no hooks) so it can be
 * rendered to static markup in the node-only web test suite — all derived state
 * is computed by the `DebugAnalysis` data wrapper and passed in as props.
 */
export function DebugAnalysisView({
	status,
	isRunning,
	analysis,
	isTriggerError,
	triggerError,
	onTrigger,
}: DebugAnalysisViewProps) {
	if (!analysis) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				{isRunning ? (
					<DebugAnalysisRunningIndicator />
				) : (
					<p className="text-muted-foreground">No debug analysis available for this run</p>
				)}
				<Button onClick={onTrigger} disabled={isRunning}>
					Run Analysis
				</Button>
				<DebugAnalysisErrors
					status={status}
					isTriggerError={isTriggerError}
					triggerError={triggerError}
				/>
			</div>
		);
	}

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
				<Button variant="outline" size="sm" onClick={onTrigger} disabled={isRunning}>
					Re-run Analysis
				</Button>
			</div>
			{isRunning && <DebugAnalysisRunningIndicator />}
			<DebugAnalysisErrors
				status={status}
				isTriggerError={isTriggerError}
				triggerError={triggerError}
			/>
			<Section title="Summary" content={analysis.summary} />
			<Section title="Issues" content={analysis.issues} />
			<Section title="Root Cause" content={analysis.rootCause} />
			<Section title="Timeline" content={analysis.timeline} />
			<Section title="Recommendations" content={analysis.recommendations} />
		</div>
	);
}

export function DebugAnalysis({ runId }: DebugAnalysisProps) {
	const queryClient = useQueryClient();
	const prevStatusRef = useRef<DebugAnalysisStatus | undefined>(undefined);
	// Polling stays active from trigger acceptance until a terminal status, even
	// across the brief window where the status row can still read `idle` before
	// the worker marks it `running`.
	const [pollingActive, setPollingActive] = useState(false);

	const analysisQuery = useQuery(trpc.runs.getDebugAnalysis.queryOptions({ runId }));

	const statusQuery = useQuery({
		...trpc.runs.getDebugAnalysisStatus.queryOptions({ runId }),
		refetchInterval: (query) =>
			debugAnalysisRefetchInterval({ status: query.state.data?.status, pollingActive }),
	});

	const status = statusQuery.data?.status;

	const triggerMutation = useMutation({
		mutationFn: () => trpcClient.runs.triggerDebugAnalysis.mutate({ runId }),
		onSuccess: () => {
			// Keep the in-progress affordance and polling alive from the instant the
			// trigger is accepted, not just while the status row reads `running`.
			setPollingActive(true);
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getDebugAnalysisStatus.queryOptions({ runId }).queryKey,
			});
		},
	});

	// When status transitions from running → completed, refetch the analysis.
	useEffect(() => {
		if (prevStatusRef.current === 'running' && status === 'completed') {
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getDebugAnalysis.queryOptions({ runId }).queryKey,
			});
		}
		prevStatusRef.current = status;
	}, [status, queryClient, runId]);

	// Clear the polling-active flag once the analysis reaches a terminal status so
	// polling stops and the buttons re-enable (failed) / settle (completed).
	useEffect(() => {
		if (isTerminalDebugAnalysisStatus(status)) {
			setPollingActive(false);
		}
	}, [status]);

	const isRunning = computeDebugAnalysisRunning({
		triggerIsPending: triggerMutation.isPending,
		triggerIsSuccess: triggerMutation.isSuccess,
		status,
	});

	if (analysisQuery.isLoading || statusQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading analysis...</div>;
	}

	return (
		<DebugAnalysisView
			status={status}
			isRunning={isRunning}
			analysis={analysisQuery.data ?? null}
			isTriggerError={triggerMutation.isError}
			triggerError={triggerMutation.error}
			onTrigger={() => triggerMutation.mutate()}
		/>
	);
}
