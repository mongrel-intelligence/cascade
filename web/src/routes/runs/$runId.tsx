import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { FileText, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { DebugAnalysis } from '@/components/debug/debug-analysis.js';
import { LlmCallList } from '@/components/llm-calls/llm-call-list.js';
import { LogViewer } from '@/components/logs/log-viewer.js';
import { CancelRunButton } from '@/components/runs/cancel-run-button.js';
import { RetryRunButton } from '@/components/runs/retry-run-button.js';
import { RunPendingState } from '@/components/runs/run-pending-state.js';
import { RunStatusBadge } from '@/components/runs/run-status-badge.js';
import { RunSummaryCard } from '@/components/runs/run-summary-card.js';
import {
	isNotFoundError,
	isRunActive,
	RUN_PENDING_MAX_RETRIES,
	RUN_PENDING_POLL_MS,
	type RunDetailView,
	resolveRunDetailView,
} from '@/lib/run-pending.js';
import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { rootRoute } from '../__root.js';

type Tab = 'overview' | 'logs' | 'llm-calls' | 'debug';

/**
 * Renders the non-ready states for the run-detail page. `pending` shows the
 * shared "Run is starting…" placeholder (a freshly-shared link can resolve
 * before the worker commits the run row); `not-found` softens the copy to
 * acknowledge the run may have been cancelled/removed; `error` surfaces the
 * underlying message.
 */
function RunDetailPlaceholder({ view, error }: { view: RunDetailView; error: unknown }) {
	if (view === 'pending') {
		return <RunPendingState />;
	}
	if (view === 'loading') {
		return <div className="py-8 text-center text-muted-foreground">Loading run...</div>;
	}
	if (view === 'not-found') {
		return (
			<div className="py-8 text-center text-destructive">
				Run not found. It may have been cancelled or removed.
			</div>
		);
	}
	// 'error' (and the unreachable 'ready' fallback): surface the error message.
	return (
		<div className="py-8 text-center text-destructive">
			{error instanceof Error ? error.message : 'Failed to load run'}
		</div>
	);
}

function RunDetailPage() {
	const { runId } = runDetailRoute.useParams();
	const [activeTab, setActiveTab] = useState<Tab>('overview');

	const runQuery = useQuery({
		...trpc.runs.getById.queryOptions({ id: runId }),
		// Poll while the run is active so status + the live-updating tabs refresh.
		refetchInterval: (query) =>
			query.state.data && isRunActive(query.state.data.status) ? 5000 : false,
		// A freshly-shared /runs/<id> link can resolve before the worker has
		// committed the run row. Retry NOT_FOUND within a bounded grace window so
		// the page resolves to the real run within seconds instead of flashing
		// "Run not found"; other errors are surfaced immediately.
		retry: (failureCount, error) =>
			isNotFoundError(error) && failureCount < RUN_PENDING_MAX_RETRIES,
		retryDelay: RUN_PENDING_POLL_MS,
	});

	const view = resolveRunDetailView({
		hasData: !!runQuery.data,
		isError: runQuery.isError,
		error: runQuery.error,
		failureCount: runQuery.failureCount,
		failureReason: runQuery.failureReason,
	});

	// Anything other than a resolved run (pending / loading / not-found / error)
	// renders a placeholder. The `!runQuery.data` clause is an unreachable
	// type-narrowing guard so `run` below is non-null.
	if (view !== 'ready' || !runQuery.data) {
		return <RunDetailPlaceholder view={view} error={runQuery.error} />;
	}

	const run = runQuery.data;

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'logs', label: 'Logs' },
		{ id: 'llm-calls', label: 'LLM Calls' },
		{ id: 'debug', label: 'Debug Analysis' },
	];

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="text-xl font-bold">{run.agentType}</h1>
				<RunStatusBadge status={run.status} />
				<CancelRunButton runId={run.id} status={run.status} />
				<RetryRunButton runId={run.id} status={run.status} />
			</div>

			{run.projectId && (run.workItemId || run.prNumber != null) && (
				<div className="flex flex-wrap items-center gap-4 text-sm">
					{run.projectId && run.workItemId && (
						<Link
							to="/work-items/$projectId/$workItemId"
							params={{ projectId: run.projectId, workItemId: run.workItemId }}
							className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
						>
							<FileText className="h-3.5 w-3.5" />
							{run.workItemTitle || run.workItemId}
							<span className="text-xs">· all runs</span>
						</Link>
					)}
					{run.projectId && run.prNumber != null && (
						<Link
							to="/prs/$projectId/$prNumber"
							params={{ projectId: run.projectId, prNumber: String(run.prNumber) }}
							className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
						>
							<GitPullRequest className="h-3.5 w-3.5" />
							PR #{run.prNumber}
							<span className="text-xs">· all runs</span>
						</Link>
					)}
				</div>
			)}

			<div className="border-b border-border overflow-x-auto">
				<nav className="flex gap-4">
					{tabs.map((tab) => (
						<button
							type="button"
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								'border-b-2 px-1 pb-3 text-sm font-medium transition-colors whitespace-nowrap',
								activeTab === tab.id
									? 'border-primary text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground',
							)}
						>
							{tab.label}
						</button>
					))}
				</nav>
			</div>

			{activeTab === 'overview' && <RunSummaryCard run={run} />}
			{activeTab === 'logs' && <LogViewer runId={runId} />}
			{activeTab === 'llm-calls' && (
				<LlmCallList runId={runId} isRunning={run.status === 'running'} />
			)}
			{activeTab === 'debug' && <DebugAnalysis runId={runId} />}
		</div>
	);
}

export const runDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/runs/$runId',
	component: RunDetailPage,
});
