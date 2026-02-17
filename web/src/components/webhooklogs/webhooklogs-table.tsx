import { formatRelativeTime } from '@/lib/utils.js';
import { useState } from 'react';
import { WebhookLogDetailDialog } from './webhooklog-detail-dialog.js';

interface WebhookLog {
	id: string;
	source: string;
	method: string;
	path: string;
	statusCode: number | null;
	receivedAt: Date | null;
	projectId: string | null;
	eventType: string | null;
	processed: boolean;
}

interface WebhookLogsTableProps {
	logs: WebhookLog[];
	total: number;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
}

const sourceBadgeColor: Record<string, string> = {
	trello: 'bg-blue-100 text-blue-800',
	github: 'bg-gray-100 text-gray-800',
	jira: 'bg-indigo-100 text-indigo-800',
};

function WebhookLogRow({
	log,
	onSelect,
}: {
	log: WebhookLog;
	onSelect: (id: string) => void;
}) {
	return (
		<tr
			className="border-b border-border transition-colors hover:bg-muted/30 cursor-pointer"
			onClick={() => onSelect(log.id)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') onSelect(log.id);
			}}
			tabIndex={0}
		>
			<td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.id.slice(0, 8)}</td>
			<td className="px-4 py-3">
				<span
					className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeColor[log.source] ?? 'bg-muted text-foreground'}`}
				>
					{log.source}
				</span>
			</td>
			<td className="px-4 py-3 text-muted-foreground">{log.eventType ?? '-'}</td>
			<td className="px-4 py-3 font-mono text-xs">{log.method}</td>
			<td className="px-4 py-3 tabular-nums">
				<span
					className={
						log.statusCode && log.statusCode >= 400 ? 'text-destructive' : 'text-foreground'
					}
				>
					{log.statusCode ?? '-'}
				</span>
			</td>
			<td className="px-4 py-3">
				<span
					className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${log.processed ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
				>
					{log.processed ? 'yes' : 'no'}
				</span>
			</td>
			<td className="px-4 py-3 text-muted-foreground">
				{formatRelativeTime(log.receivedAt?.toISOString() ?? null)}
			</td>
		</tr>
	);
}

export function WebhookLogsTable({
	logs,
	total,
	offset,
	limit,
	onPageChange,
}: WebhookLogsTableProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Event</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Method</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Processed</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Received</th>
						</tr>
					</thead>
					<tbody>
						{logs.length === 0 && (
							<tr>
								<td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
									No webhook logs found
								</td>
							</tr>
						)}
						{logs.map((log) => (
							<WebhookLogRow key={log.id} log={log} onSelect={setSelectedId} />
						))}
					</tbody>
				</table>
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>
						Page {currentPage} of {totalPages} ({total} total)
					</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => onPageChange(Math.max(0, offset - limit))}
							disabled={offset === 0}
							className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-muted"
						>
							Previous
						</button>
						<button
							type="button"
							onClick={() => onPageChange(offset + limit)}
							disabled={offset + limit >= total}
							className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-muted"
						>
							Next
						</button>
					</div>
				</div>
			)}

			{selectedId && <WebhookLogDetailDialog id={selectedId} onClose={() => setSelectedId(null)} />}
		</div>
	);
}
