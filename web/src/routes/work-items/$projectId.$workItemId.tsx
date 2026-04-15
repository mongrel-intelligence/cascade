import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { WorkItemDurationChart } from '@/components/runs/work-item-duration-chart.js';
import { WorkItemRunsTable } from '@/components/runs/work-item-runs-table.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

function WorkItemRunsPage() {
	const { projectId, workItemId } = workItemRunsRoute.useParams();

	const runsQuery = useQuery({
		...trpc.workItems.runs.queryOptions({ projectId, workItemId }),
		refetchInterval: (query) => {
			const hasRunning = query.state.data?.some((r) => r.status === 'running');
			return hasRunning ? 5000 : false;
		},
	});

	const runs = runsQuery.data;
	const firstRun = runs?.[0];
	const workItemTitle = firstRun?.workItemTitle ?? workItemId;
	const workItemUrl = firstRun?.workItemUrl;

	return (
		<div className="space-y-6">
			<h1 className="text-xl font-bold">Work Item Runs</h1>

			<div className="space-y-1">
				<div className="flex items-center gap-2">
					{workItemUrl ? (
						<a
							href={workItemUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-lg font-semibold text-primary hover:underline"
						>
							{workItemTitle}
							<ExternalLink className="h-4 w-4 shrink-0" />
						</a>
					) : (
						<span className="text-lg font-semibold">{workItemTitle}</span>
					)}
				</div>
			</div>

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

export const workItemRunsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/work-items/$projectId/$workItemId',
	component: WorkItemRunsPage,
});
