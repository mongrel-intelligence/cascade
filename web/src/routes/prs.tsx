import { PRsTable } from '@/components/prs/prs-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root.js';

const searchSchema = z.object({
	projectId: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function PRsPage() {
	const navigate = useNavigate({ from: '/prs' });
	const search = useSearch({ from: '/prs' });

	const projectId = search.projectId ?? '';
	const offset = search.offset ?? 0;
	const limit = 50;

	const projectsQuery = useQuery(trpc.projects.list.queryOptions());

	const prsQuery = useQuery(
		trpc.prs.list.queryOptions({
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
				<h1 className="text-2xl font-bold tracking-tight">PRs</h1>
				{prsQuery.data && (
					<span className="text-sm text-muted-foreground">{prsQuery.data.length} total</span>
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

			{prsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading PRs...</div>
			)}

			{prsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load PRs: {prsQuery.error.message}
				</div>
			)}

			{prsQuery.data && (
				<PRsTable
					items={prsQuery.data}
					offset={offset}
					limit={limit}
					onPageChange={(newOffset) => updateSearch({ offset: newOffset })}
					showRepoName={!projectId}
				/>
			)}
		</div>
	);
}

export const prsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/prs',
	component: PRsPage,
	validateSearch: searchSchema,
});
