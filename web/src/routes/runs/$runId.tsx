import { DebugAnalysis } from '@/components/debug/debug-analysis.js';
import { LlmCallList } from '@/components/llm-calls/llm-call-list.js';
import { LogViewer } from '@/components/logs/log-viewer.js';
import { CancelRunButton } from '@/components/runs/cancel-run-button.js';
import { RetryRunButton } from '@/components/runs/retry-run-button.js';
import { RunStatusBadge } from '@/components/runs/run-status-badge.js';
import { RunSummaryCard } from '@/components/runs/run-summary-card.js';
import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, FileText, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

type Tab = 'overview' | 'logs' | 'llm-calls' | 'debug';

function RunDetailPage() {
	const { runId } = runDetailRoute.useParams();
	const [activeTab, setActiveTab] = useState<Tab>('overview');

	const runQuery = useQuery(trpc.runs.getById.queryOptions({ id: runId }));

	if (runQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading run...</div>;
	}

	if (runQuery.isError || !runQuery.data) {
		return <div className="py-8 text-center text-destructive">Run not found</div>;
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
				<Link
					to="/"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back
				</Link>
				<span className="text-muted-foreground">/</span>
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
			{activeTab === 'llm-calls' && <LlmCallList runId={runId} />}
			{activeTab === 'debug' && <DebugAnalysis runId={runId} />}
		</div>
	);
}

export const runDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/runs/$runId',
	component: RunDetailPage,
});
