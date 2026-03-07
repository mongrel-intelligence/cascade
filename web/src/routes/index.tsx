import { RunFilters } from '@/components/runs/run-filters.js';
import { RunsTable } from '@/components/runs/runs-table.js';
import { TriggerRunDialog } from '@/components/runs/trigger-run-dialog.js';
import { Button } from '@/components/ui/button.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { rootRoute } from './__root.js';

const searchSchema = z.object({
	projectId: z.string().optional().catch(undefined),
	status: z.string().optional().catch(undefined),
	agentType: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function RunsListPage() {
	const navigate = useNavigate({ from: '/' });
	const search = useSearch({ from: '/' });
	const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);

	const projectId = search.projectId ?? '';
	const status = search.status ?? '';
	const agentType = search.agentType ?? '';
	const offset = search.offset ?? 0;
	const limit = 50;

	const runsQuery = useQuery({
		...trpc.runs.list.queryOptions({
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

	function updateSearch(updates: Record<string, string | number | undefined>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				offset: updates.offset !== undefined ? updates.offset : 0,
			}),
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Agent Runs</h1>
				<div className="flex items-center gap-3">
					{runsQuery.data && (
						<span className="text-sm text-muted-foreground">{runsQuery.data.total} total</span>
					)}
					<Button size="sm" onClick={() => setTriggerDialogOpen(true)}>
						<Play className="mr-1 h-4 w-4" />
						Trigger Run
					</Button>
				</div>
			</div>
			<TriggerRunDialog open={triggerDialogOpen} onOpenChange={setTriggerDialogOpen} />

			<RunFilters
				projectId={projectId}
				status={status}
				agentType={agentType}
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
				/>
			)}
		</div>
	);
}

export const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: RunsListPage,
	validateSearch: searchSchema,
});
