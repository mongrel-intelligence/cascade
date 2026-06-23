import { Badge } from '@/components/ui/badge.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
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
		linear: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
		sentry: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
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
			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead className="px-4 py-3">Source</TableHead>
							<TableHead className="px-4 py-3">Event Type</TableHead>
							<TableHead className="hidden px-4 py-3 md:table-cell">Method</TableHead>
							<TableHead className="hidden px-4 py-3 text-right md:table-cell">Status</TableHead>
							<TableHead className="px-4 py-3 text-center">Processed</TableHead>
							<TableHead className="hidden px-4 py-3 md:table-cell">Reason</TableHead>
							<TableHead className="px-4 py-3 text-right">Time</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{logs.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={7}
									className="px-4 py-8 text-center whitespace-normal text-muted-foreground"
								>
									No webhook logs found
								</TableCell>
							</TableRow>
						)}
						{logs.map((log) => (
							<TableRow
								key={log.id}
								className="cursor-pointer"
								onClick={() => onRowClick(log.id)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') onRowClick(log.id);
								}}
							>
								<TableCell className="px-4 py-3">
									<SourceBadge source={log.source} />
								</TableCell>
								<TableCell className="px-4 py-3 text-muted-foreground">
									{log.eventType ?? '-'}
								</TableCell>
								<TableCell className="hidden px-4 py-3 font-mono text-xs md:table-cell">
									{log.method}
								</TableCell>
								<TableCell className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
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
								</TableCell>
								<TableCell className="px-4 py-3 text-center">
									{log.processed ? (
										<Badge variant="default" className="text-xs">
											Yes
										</Badge>
									) : (
										<Badge variant="secondary" className="text-xs">
											No
										</Badge>
									)}
								</TableCell>
								<TableCell
									className="hidden max-w-[200px] truncate px-4 py-3 text-muted-foreground md:table-cell"
									title={log.decisionReason ?? undefined}
								>
									{log.decisionReason ?? '-'}
								</TableCell>
								<TableCell className="px-4 py-3 text-right text-muted-foreground">
									{formatRelativeTime(log.receivedAt)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{total > limit && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
