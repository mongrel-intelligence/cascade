import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { WorkItemDurationChart } from '@/components/runs/work-item-duration-chart.js';
import { WorkItemRunsTable } from '@/components/runs/work-item-runs-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { rootRoute } from '../__root.js';

function PRRunsPage() {
	const { projectId, prNumber: prNumberStr } = prRunsRoute.useParams();
	const prNumber = Number(prNumberStr);

	const runsQuery = useQuery({
		...trpc.prs.runs.queryOptions({ projectId, prNumber }),
		refetchInterval: (query) => {
			const hasRunning = query.state.data?.some((r) => r.status === 'running');
			return hasRunning ? 5000 : false;
		},
	});

	const runs = runsQuery.data;
	const firstRun = runs?.[0];
	const prTitle = firstRun?.prTitle ?? null;
	const prUrl = firstRun?.prUrl ?? null;

	const runningCount = runs?.filter((r) => r.status === 'running').length ?? 0;
	const totalCount = runs?.length ?? 0;
	const completedCount = runs?.filter((r) => r.status === 'completed').length ?? 0;
	const failedCount = runs?.filter((r) => r.status === 'failed').length ?? 0;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2">
				<Link
					to="/projects/$projectId"
					params={{ projectId }}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Project
				</Link>
				<span className="text-muted-foreground">/</span>
				<h1 className="text-xl font-bold">PR Runs</h1>
			</div>

			<div className="space-y-1">
				<div className="flex items-center gap-2">
					{prUrl ? (
						<a
							href={prUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-lg font-semibold text-primary hover:underline"
						>
							PR #{prNumber}
							{prTitle && <span className="ml-1 text-foreground">{prTitle}</span>}
							<ExternalLink className="h-4 w-4 shrink-0" />
						</a>
					) : (
						<span className="text-lg font-semibold">
							PR #{prNumber}
							{prTitle && <span className="ml-1">{prTitle}</span>}
						</span>
					)}
				</div>
			</div>

			{runs && (
				<div className="flex gap-6 text-sm">
					<div>
						<span className="font-medium">{totalCount}</span>
						<span className="ml-1 text-muted-foreground">total</span>
					</div>
					{runningCount > 0 && (
						<div>
							<span className="font-medium text-blue-600">{runningCount}</span>
							<span className="ml-1 text-muted-foreground">running</span>
						</div>
					)}
					<div>
						<span className="font-medium">{completedCount}</span>
						<span className="ml-1 text-muted-foreground">completed</span>
					</div>
					{failedCount > 0 && (
						<div>
							<span className="font-medium text-destructive">{failedCount}</span>
							<span className="ml-1 text-muted-foreground">failed</span>
						</div>
					)}
				</div>
			)}

			{runs && runs.length > 0 && (
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<WorkItemDurationChart runs={runs} />
					<WorkItemCostChart runs={runs} />
				</div>
			)}

			<WorkItemRunsTable
				runs={runsQuery.data}
				isLoading={runsQuery.isLoading}
				isError={runsQuery.isError}
				error={runsQuery.error}
			/>
		</div>
	);
}

export const prRunsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/prs/$projectId/$prNumber',
	component: PRRunsPage,
});
