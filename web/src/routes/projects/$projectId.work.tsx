import { ProjectWorkTable } from '@/components/projects/project-work-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { projectDetailRoute } from './$projectId.js';

const WORK_PAGE_SIZE = 50;

function ProjectWorkPage() {
	const { projectId } = projectWorkRoute.useParams();
	const [workOffset, setWorkOffset] = useState(0);

	const workQuery = useQuery(trpc.prs.listUnifiedWithDurations.queryOptions({ projectId }));

	const items = workQuery.data?.items ?? [];
	const projectAvgDurationMs = workQuery.data?.projectAvgDurationMs ?? null;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Work</h2>
				{workQuery.data && (
					<span className="text-sm text-muted-foreground">{items.length} total</span>
				)}
			</div>

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
					items={items}
					projectId={projectId}
					offset={workOffset}
					limit={WORK_PAGE_SIZE}
					onPageChange={setWorkOffset}
					projectAvgDurationMs={projectAvgDurationMs}
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
