import { WebhookLogsTable } from '@/components/webhooklogs/webhooklogs-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root.js';

const searchSchema = z.object({
	source: z.string().optional().catch(undefined),
	eventType: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function WebhookLogsPage() {
	const navigate = useNavigate({ from: '/webhooklogs' });
	const search = useSearch({ from: '/webhooklogs' });

	const source = search.source ?? '';
	const eventType = search.eventType ?? '';
	const offset = search.offset ?? 0;
	const limit = 50;

	const logsQuery = useQuery(
		trpc.webhookLogs.list.queryOptions({
			source: source || undefined,
			eventType: eventType || undefined,
			limit,
			offset,
		}),
	);

	const statsQuery = useQuery(trpc.webhookLogs.getStats.queryOptions());

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
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Webhook Logs</h1>
				{logsQuery.data && (
					<span className="text-sm text-muted-foreground">{logsQuery.data.total} total</span>
				)}
			</div>

			{statsQuery.data && statsQuery.data.length > 0 && (
				<div className="flex gap-4">
					{statsQuery.data.map((stat) => (
						<div
							key={stat.source}
							className="rounded-lg border border-border bg-card px-4 py-2 text-sm"
						>
							<span className="font-medium capitalize">{stat.source}</span>
							<span className="ml-2 text-muted-foreground">{stat.count}</span>
						</div>
					))}
				</div>
			)}

			<div className="flex gap-3">
				<select
					value={source}
					onChange={(e) => updateSearch({ source: e.target.value || undefined })}
					className="rounded-md border border-input bg-background px-3 py-2 text-sm"
				>
					<option value="">All sources</option>
					<option value="trello">Trello</option>
					<option value="github">GitHub</option>
					<option value="jira">JIRA</option>
				</select>

				<input
					type="text"
					placeholder="Filter by event type..."
					value={eventType}
					onChange={(e) => updateSearch({ eventType: e.target.value || undefined })}
					className="rounded-md border border-input bg-background px-3 py-2 text-sm w-56"
				/>
			</div>

			{logsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading webhook logs...</div>
			)}

			{logsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load webhook logs: {logsQuery.error.message}
				</div>
			)}

			{logsQuery.data && (
				<WebhookLogsTable
					logs={logsQuery.data.data.map((l) => ({
						...l,
						receivedAt: l.receivedAt ? new Date(l.receivedAt) : null,
					}))}
					total={logsQuery.data.total}
					offset={offset}
					limit={limit}
					onPageChange={(newOffset) => updateSearch({ offset: newOffset })}
				/>
			)}
		</div>
	);
}

export const webhookLogsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/webhooklogs',
	component: WebhookLogsPage,
	validateSearch: searchSchema,
});
