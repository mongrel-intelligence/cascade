import { Badge } from '@/components/ui/badge.js';
import { formatRelativeTime } from '@/lib/utils.js';

interface WebhookLog {
	id: string;
	source: string;
	eventType: string | null;
	statusCode: number | null;
	processed: boolean | null;
	receivedAt: string | null;
	method: string;
	path: string;
	decisionReason: string | null;
}

interface WebhookLogsTableProps {
	logs: WebhookLog[];
	total: number;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
	onRowClick: (id: string) => void;
}

function SourceBadge({ source }: { source: string }) {
	const colorMap: Record<string, string> = {
		trello: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
		github: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
		jira: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
	};
	const className = colorMap[source] ?? 'bg-muted text-muted-foreground';
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
		>
			{source}
		</span>
	);
}

export function WebhookLogsTable({
	logs,
	total,
	offset,
	limit,
	onPageChange,
	onRowClick,
}: WebhookLogsTableProps) {
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Event Type</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Method</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Status</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">Processed</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Reason</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Time</th>
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
							<tr
								key={log.id}
								className="cursor-pointer border-b border-border transition-colors hover:bg-muted/30"
								onClick={() => onRowClick(log.id)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') onRowClick(log.id);
								}}
							>
								<td className="px-4 py-3">
									<SourceBadge source={log.source} />
								</td>
								<td className="px-4 py-3 text-muted-foreground">{log.eventType ?? '-'}</td>
								<td className="px-4 py-3 font-mono text-xs">{log.method}</td>
								<td className="px-4 py-3 text-right tabular-nums">
									{log.statusCode != null ? (
										<span
											className={
												log.statusCode >= 400
													? 'text-destructive'
													: 'text-green-600 dark:text-green-400'
											}
										>
											{log.statusCode}
										</span>
									) : (
										'-'
									)}
								</td>
								<td className="px-4 py-3 text-center">
									{log.processed ? (
										<Badge variant="default" className="text-xs">
											Yes
										</Badge>
									) : (
										<Badge variant="secondary" className="text-xs">
											No
										</Badge>
									)}
								</td>
								<td
									className="px-4 py-3 text-muted-foreground max-w-[200px] truncate"
									title={log.decisionReason ?? undefined}
								>
									{log.decisionReason ?? '-'}
								</td>
								<td className="px-4 py-3 text-right text-muted-foreground">
									{formatRelativeTime(log.receivedAt)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{total > limit && (
				<div className="flex items-center justify-between">
					<div className="text-sm text-muted-foreground">
						Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => onPageChange(Math.max(0, offset - limit))}
							disabled={offset === 0}
							className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
						>
							Previous
						</button>
						<span className="inline-flex h-8 items-center px-2 text-sm text-muted-foreground">
							Page {currentPage} of {totalPages}
						</span>
						<button
							type="button"
							onClick={() => onPageChange(offset + limit)}
							disabled={offset + limit >= total}
							className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
						>
							Next
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
