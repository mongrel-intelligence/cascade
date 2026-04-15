import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { StatsFilters } from '@/components/projects/stats-filters.js';
import { StatsFiltersBar } from '@/components/projects/stats-filters.js';
import { StatsSummary } from '@/components/projects/stats-summary.js';
import { ProjectWorkDurationChart } from '@/components/runs/project-work-duration-chart.js';
import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { trpc } from '@/lib/trpc.js';
import { projectDetailRoute } from './$projectId.js';

export function computeDateFrom(timeRange: string): string | undefined {
	if (timeRange === 'all') return undefined;
	const days = Number.parseInt(timeRange, 10);
	if (Number.isNaN(days)) return undefined;
	const d = new Date(Date.now() - days * 86400000);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function ProjectStatsPage() {
	const { projectId } = projectStatsRoute.useParams();

	const [filters, setFilters] = useState<StatsFilters>({
		timeRange: '30',
		agentType: '',
		status: '',
	});

	const dateFrom = useMemo(() => computeDateFrom(filters.timeRange), [filters.timeRange]);

	const statsQuery = useQuery(
		trpc.prs.workStatsAggregated.queryOptions({
			projectId,
			dateFrom,
			agentType: filters.agentType || undefined,
			status: filters.status || undefined,
		}),
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Stats</h2>
			</div>

			<StatsFiltersBar filters={filters} onFilterChange={setFilters} />

			{statsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading stats...</div>
			)}

			{statsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load stats: {statsQuery.error.message}
				</div>
			)}

			{statsQuery.data && (
				<>
					<StatsSummary
						totalRuns={statsQuery.data.summary.totalRuns}
						totalCostUsd={statsQuery.data.summary.totalCostUsd}
						avgDurationMs={statsQuery.data.summary.avgDurationMs}
						successRate={statsQuery.data.summary.successRate}
					/>

					{statsQuery.data.summary.totalRuns > 0 ? (
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
							<WorkItemCostChart byAgentType={statsQuery.data.byAgentType} />
							<ProjectWorkDurationChart byAgentType={statsQuery.data.byAgentType} />
						</div>
					) : (
						<div className="py-8 text-center text-muted-foreground">
							No runs match the selected filters.
						</div>
					)}
				</>
			)}
		</div>
	);
}

export const projectStatsRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/stats',
	component: ProjectStatsPage,
});
