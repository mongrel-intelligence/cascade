import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { useRef } from 'react';
import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { WorkItemDurationChart } from '@/components/runs/work-item-duration-chart.js';
import { WorkItemRunsTable } from '@/components/runs/work-item-runs-table.js';
import { resolveWorkItemRunsView, workItemRunsRefetchInterval } from '@/lib/run-pending.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

function WorkItemRunsPage() {
	const { projectId, workItemId } = workItemRunsRoute.useParams();

	// A work-item runs link is posted at ack time — before the worker commits the
	// run row — so the first fetches can return an empty list. Track when the page
	// mounted so we can keep polling through (and show a "starting" state during)
	// the bounded grace window instead of flashing a terminal "No runs found".
	const mountedAt = useRef(Date.now());

	const runsQuery = useQuery({
		...trpc.workItems.runs.queryOptions({ projectId, workItemId }),
		refetchInterval: (query) => {
			const data = query.state.data;
			const hasRunning = data?.some((r) => r.status === 'running') ?? false;
			const isEmpty = (data?.length ?? 0) === 0;
			const elapsedMs = Date.now() - mountedAt.current;
			return workItemRunsRefetchInterval({ hasRunning, isEmpty, elapsedMs });
		},
	});

	const runs = runsQuery.data;
	const firstRun = runs?.[0];
	const workItemTitle = firstRun?.workItemTitle ?? workItemId;
	const workItemUrl = firstRun?.workItemUrl;

	// Within the grace window an empty list means "the worker is still starting",
	// not "no runs" — render the shared pending placeholder in that case.
	const isPending =
		resolveWorkItemRunsView({
			isLoading: runsQuery.isLoading,
			isError: runsQuery.isError,
			isEmpty: (runs?.length ?? 0) === 0,
			elapsedMs: Date.now() - mountedAt.current,
		}) === 'pending';

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
				isPending={isPending}
			/>
		</div>
	);
}

export const workItemRunsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/work-items/$projectId/$workItemId',
	component: WorkItemRunsPage,
});
