import { WebhookLogDetailDialog } from '@/components/webhooklogs/webhooklog-detail-dialog.js';
import { WebhookLogsTable } from '@/components/webhooklogs/webhooklogs-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { rootRoute } from '../__root.js';

const searchSchema = z.object({
	source: z.string().optional().catch(undefined),
	eventType: z.string().optional().catch(undefined),
	offset: z.number().optional().catch(0),
});

function WebhookLogsPage() {
	const navigate = useNavigate({ from: '/global/webhook-logs' });
	const search = useSearch({ from: '/global/webhook-logs' });
	const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

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

	function updateSearch(updates: Record<string, string | number | undefined>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				offset: updates.offset !== undefined ? Number(updates.offset) : 0,
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

			{/* Filters */}
			<div className="flex flex-wrap gap-3">
				<select
					value={source}
					onChange={(e) => updateSearch({ source: e.target.value || undefined })}
					className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
				>
					<option value="">All sources</option>
					<option value="trello">Trello</option>
					<option value="github">GitHub</option>
					<option value="jira">JIRA</option>
				</select>

				<input
					type="text"
					placeholder="Event type..."
					value={eventType}
					onChange={(e) => updateSearch({ eventType: e.target.value || undefined })}
					className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
				/>
			</div>

			{logsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading webhook logs...</div>
			)}

			{logsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load logs: {logsQuery.error.message}
				</div>
			)}

			{logsQuery.data && (
				<WebhookLogsTable
					logs={logsQuery.data.data}
					total={logsQuery.data.total}
					offset={offset}
					limit={limit}
					onPageChange={(newOffset) => updateSearch({ offset: newOffset })}
					onRowClick={(id) => setSelectedLogId(id)}
				/>
			)}

			<WebhookLogDetailDialog logId={selectedLogId} onClose={() => setSelectedLogId(null)} />
		</div>
	);
}

export const globalWebhookLogsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/webhook-logs',
	component: WebhookLogsPage,
	validateSearch: searchSchema,
});
