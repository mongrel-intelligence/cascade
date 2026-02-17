import { DebugAnalysis } from '@/components/debug/debug-analysis.js';
import { LlmCallList } from '@/components/llm-calls/llm-call-list.js';
import { LogViewer } from '@/components/logs/log-viewer.js';
import { RetryRunButton } from '@/components/runs/retry-run-button.js';
import { RunStatusBadge } from '@/components/runs/run-status-badge.js';
import { RunSummaryCard } from '@/components/runs/run-summary-card.js';
import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
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
			<div className="flex items-center gap-3">
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
				<RetryRunButton runId={run.id} status={run.status} />
			</div>

			<div className="border-b border-border">
				<nav className="flex gap-4">
					{tabs.map((tab) => (
						<button
							type="button"
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
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
