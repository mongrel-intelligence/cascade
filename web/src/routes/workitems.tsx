import { WorkItemsTable } from '@/components/workitems/workitems-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root.js';

const searchSchema = z.object({
	projectId: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function WorkItemsPage() {
	const navigate = useNavigate({ from: '/workitems' });
	const search = useSearch({ from: '/workitems' });

	const projectId = search.projectId ?? '';
	const offset = search.offset ?? 0;
	const limit = 50;

	const projectsQuery = useQuery(trpc.projects.list.queryOptions());

	const workItemsQuery = useQuery(
		trpc.workItems.list.queryOptions({
			projectId: projectId || undefined,
		}),
	);

	function updateSearch(updates: Record<string, string | number | undefined>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				offset: updates.offset !== undefined ? Number(updates.offset) : 0,
			}),
		});
	}

	const selectClass =
		'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto';

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Work Items</h1>
				{workItemsQuery.data && (
					<span className="text-sm text-muted-foreground">{workItemsQuery.data.length} total</span>
				)}
			</div>

			{/* Project filter */}
			<div className="flex flex-wrap gap-3">
				<select
					value={projectId}
					onChange={(e) => updateSearch({ projectId: e.target.value || undefined })}
					className={selectClass}
				>
					<option value="">All projects</option>
					{projectsQuery.data?.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</div>

			{workItemsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading work items...</div>
			)}

			{workItemsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load work items: {workItemsQuery.error.message}
				</div>
			)}

			{workItemsQuery.data && (
				<WorkItemsTable
					items={workItemsQuery.data}
					offset={offset}
					limit={limit}
					onPageChange={(newOffset) => updateSearch({ offset: newOffset })}
				/>
			)}
		</div>
	);
}

export const workItemsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/workitems',
	component: WorkItemsPage,
	validateSearch: searchSchema,
});
