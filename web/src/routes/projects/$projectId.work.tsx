import { ProjectWorkTable } from '@/components/projects/project-work-table.js';
import { ProjectWorkDurationChart } from '@/components/runs/project-work-duration-chart.js';
import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { trpc } from '@/lib/trpc.js';
import { formatCost } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { projectDetailRoute } from './$projectId.js';

const WORK_PAGE_SIZE = 50;

function ProjectWorkPage() {
	const { projectId } = projectWorkRoute.useParams();
	const [workOffset, setWorkOffset] = useState(0);

	const workQuery = useQuery(trpc.prs.listUnified.queryOptions({ projectId }));
	const workStatsQuery = useQuery(trpc.prs.workStats.queryOptions({ projectId }));

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Work</h2>
				{workQuery.data && (
					<span className="text-sm text-muted-foreground">{workQuery.data.length} total</span>
				)}
			</div>

			{workStatsQuery.data && workStatsQuery.data.length > 0 && (
				<>
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
						<WorkItemCostChart
							runs={workStatsQuery.data.map((r, i) => ({ ...r, id: String(i) }))}
						/>
						<ProjectWorkDurationChart runs={workStatsQuery.data} />
					</div>
					<div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
						<span>
							<span className="font-medium text-foreground">
								{workStatsQuery.data.length >= 500 ? '500+' : workStatsQuery.data.length}
							</span>{' '}
							{workStatsQuery.data.length >= 500
								? 'latest runs (showing most recent 500)'
								: 'total runs'}
						</span>
						<span>
							<span className="font-medium text-foreground">
								{formatCost(
									workStatsQuery.data
										.reduce(
											(sum, r) => sum + (r.costUsd != null ? Number.parseFloat(r.costUsd) : 0),
											0,
										)
										.toFixed(4),
								)}
							</span>{' '}
							total cost
						</span>
					</div>
				</>
			)}

			{workQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading work items...</div>
			)}

			{workQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load work: {workQuery.error.message}
				</div>
			)}

			{workQuery.data && (
				<ProjectWorkTable
					items={workQuery.data}
					projectId={projectId}
					offset={workOffset}
					limit={WORK_PAGE_SIZE}
					onPageChange={setWorkOffset}
				/>
			)}
		</div>
	);
}

export const projectWorkRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/work',
	component: ProjectWorkPage,
});
