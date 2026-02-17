import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface WebhookLogDetailDialogProps {
	id: string;
	onClose: () => void;
}

export function WebhookLogDetailDialog({ id, onClose }: WebhookLogDetailDialogProps) {
	const logQuery = useQuery(trpc.webhookLogs.getById.queryOptions({ id }));

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="relative w-full max-w-3xl max-h-[80vh] overflow-auto rounded-lg border border-border bg-background shadow-xl">
				<div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-6 py-4">
					<h2 className="text-lg font-semibold">Webhook Log Detail</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 hover:bg-muted text-muted-foreground"
					>
						✕
					</button>
				</div>

				<div className="p-6 space-y-6">
					{logQuery.isLoading && (
						<div className="text-center text-muted-foreground">Loading...</div>
					)}
					{logQuery.isError && (
						<div className="text-center text-destructive">
							Failed to load log: {logQuery.error.message}
						</div>
					)}
					{logQuery.data && (
						<>
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<span className="font-medium text-muted-foreground">ID</span>
									<p className="font-mono mt-1">{logQuery.data.id}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Source</span>
									<p className="mt-1">{logQuery.data.source}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Method</span>
									<p className="font-mono mt-1">{logQuery.data.method}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Path</span>
									<p className="font-mono mt-1">{logQuery.data.path}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Event Type</span>
									<p className="mt-1">{logQuery.data.eventType ?? '-'}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Status Code</span>
									<p className="mt-1">{logQuery.data.statusCode ?? '-'}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Processed</span>
									<p className="mt-1">{logQuery.data.processed ? 'Yes' : 'No'}</p>
								</div>
								<div>
									<span className="font-medium text-muted-foreground">Received At</span>
									<p className="mt-1">
										{logQuery.data.receivedAt
											? new Date(logQuery.data.receivedAt).toLocaleString()
											: '-'}
									</p>
								</div>
								{logQuery.data.projectId && (
									<div>
										<span className="font-medium text-muted-foreground">Project ID</span>
										<p className="font-mono mt-1">{logQuery.data.projectId}</p>
									</div>
								)}
							</div>

							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-2">Headers</h3>
								<pre className="overflow-auto rounded bg-muted p-4 text-xs font-mono max-h-48">
									{JSON.stringify(logQuery.data.headers, null, 2) || '(none)'}
								</pre>
							</div>

							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-2">Body</h3>
								<pre className="overflow-auto rounded bg-muted p-4 text-xs font-mono max-h-64">
									{logQuery.data.body
										? JSON.stringify(logQuery.data.body, null, 2)
										: logQuery.data.bodyRaw || '(empty)'}
								</pre>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
