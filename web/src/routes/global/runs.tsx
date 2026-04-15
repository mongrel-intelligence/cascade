import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { RunFilters } from '@/components/runs/run-filters.js';
import { RunsTable } from '@/components/runs/runs-table.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

const searchSchema = z.object({
	projectId: z.string().optional().catch(undefined),
	status: z.string().optional().catch(undefined),
	agentType: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function GlobalRunsPage() {
	const navigate = useNavigate({ from: '/global/runs' });
	const search = useSearch({ from: '/global/runs' });

	const projectId = search.projectId ?? '';
	const status = search.status ?? '';
	const agentType = search.agentType ?? '';
	const offset = search.offset ?? 0;
	const limit = 50;

	const projectsQuery = useQuery(trpc.projects.listAll.queryOptions());

	const runsQuery = useQuery({
		...trpc.runs.listAll.queryOptions({
			projectId: projectId || undefined,
			status: status ? [status] : undefined,
			agentType: agentType || undefined,
			limit,
			offset,
		}),
		refetchInterval: (query) => {
			const hasRunning = query.state.data?.data?.some((r) => r.status === 'running');
			return hasRunning ? 5000 : false;
		},
	});

	function updateSearch(updates: Partial<z.infer<typeof searchSchema>>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				offset: updates.offset !== undefined ? (updates.offset as number) : 0,
			}),
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Global Runs</h1>
				{runsQuery.data && (
					<span className="text-sm text-muted-foreground">{runsQuery.data.total} total</span>
				)}
			</div>

			<RunFilters
				projectId={projectId}
				status={status}
				agentType={agentType}
				projects={projectsQuery.data}
				onProjectChange={(v) => updateSearch({ projectId: v || undefined })}
				onStatusChange={(v) => updateSearch({ status: v || undefined })}
				onAgentTypeChange={(v) => updateSearch({ agentType: v || undefined })}
			/>

			{runsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading runs...</div>
			)}

			{runsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load runs: {runsQuery.error.message}
				</div>
			)}

			{runsQuery.data && (
				<RunsTable
					runs={runsQuery.data.data}
					total={runsQuery.data.total}
					offset={offset}
					limit={limit}
					onPageChange={(newOffset) => updateSearch({ offset: newOffset })}
					showOrg={true}
				/>
			)}
		</div>
	);
}

export const globalRunsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/runs',
	component: GlobalRunsPage,
	validateSearch: searchSchema,
});
