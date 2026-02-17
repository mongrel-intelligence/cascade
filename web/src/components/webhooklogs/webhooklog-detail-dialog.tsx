import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface WebhookLogDetailDialogProps {
	logId: string | null;
	onClose: () => void;
}

function JsonBlock({ value }: { value: unknown }) {
	return (
		<pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

export function WebhookLogDetailDialog({ logId, onClose }: WebhookLogDetailDialogProps) {
	const logQuery = useQuery({
		...trpc.webhookLogs.getById.queryOptions({ id: logId ?? '' }),
		enabled: !!logId,
	});

	const log = logQuery.data;

	return (
		<Dialog
			open={!!logId}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Webhook Log Detail</DialogTitle>
				</DialogHeader>

				{logQuery.isLoading && (
					<div className="py-8 text-center text-muted-foreground">Loading...</div>
				)}

				{logQuery.isError && (
					<div className="py-8 text-center text-destructive">
						Failed to load log: {logQuery.error.message}
					</div>
				)}

				{log && (
					<div className="space-y-4 text-sm">
						<div className="grid grid-cols-2 gap-3">
							<div>
								<div className="text-xs font-medium text-muted-foreground">ID</div>
								<div className="font-mono text-xs">{log.id}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Source</div>
								<div>{log.source}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Method</div>
								<div className="font-mono">{log.method}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Path</div>
								<div className="font-mono text-xs">{log.path}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Event Type</div>
								<div>{log.eventType ?? '-'}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Status Code</div>
								<div>{log.statusCode ?? '-'}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Processed</div>
								<div>{log.processed ? 'Yes' : 'No'}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Project ID</div>
								<div>{log.projectId ?? '-'}</div>
							</div>
							<div>
								<div className="text-xs font-medium text-muted-foreground">Received At</div>
								<div>{log.receivedAt ? new Date(log.receivedAt).toLocaleString() : '-'}</div>
							</div>
						</div>

						{log.headers && (
							<div>
								<div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
								<JsonBlock value={log.headers} />
							</div>
						)}

						{log.body && (
							<div>
								<div className="mb-1 text-xs font-medium text-muted-foreground">Body</div>
								<JsonBlock value={log.body} />
							</div>
						)}

						{!log.body && log.bodyRaw && (
							<div>
								<div className="mb-1 text-xs font-medium text-muted-foreground">Body (raw)</div>
								<pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
									{log.bodyRaw}
								</pre>
							</div>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
