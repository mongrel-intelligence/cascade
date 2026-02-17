import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface WebhookLogDetailDialogProps {
	id: string | null;
	onClose: () => void;
}

function JsonBlock({ data }: { data: unknown }) {
	if (data == null) return <span className="text-muted-foreground italic">null</span>;
	return (
		<pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
			{JSON.stringify(data, null, 2)}
		</pre>
	);
}

export function WebhookLogDetailDialog({ id, onClose }: WebhookLogDetailDialogProps) {
	const logQuery = useQuery({
		...trpc.webhookLogs.getById.queryOptions({ id: id ?? '' }),
		enabled: id != null,
	});

	return (
		<Dialog open={id != null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Webhook Log Detail</DialogTitle>
				</DialogHeader>

				{logQuery.isLoading && (
					<div className="py-8 text-center text-muted-foreground">Loading...</div>
				)}

				{logQuery.isError && (
					<div className="py-4 text-center text-destructive">Failed to load log details.</div>
				)}

				{logQuery.data && (
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
							<div className="font-medium text-muted-foreground">ID</div>
							<div className="font-mono text-xs">{logQuery.data.id}</div>

							<div className="font-medium text-muted-foreground">Source</div>
							<div>{logQuery.data.source}</div>

							<div className="font-medium text-muted-foreground">Method</div>
							<div>{logQuery.data.method}</div>

							<div className="font-medium text-muted-foreground">Path</div>
							<div>{logQuery.data.path}</div>

							<div className="font-medium text-muted-foreground">Event Type</div>
							<div>{logQuery.data.eventType ?? '—'}</div>

							<div className="font-medium text-muted-foreground">Status Code</div>
							<div>{logQuery.data.statusCode ?? '—'}</div>

							<div className="font-medium text-muted-foreground">Processed</div>
							<div>{logQuery.data.processed ? 'yes' : 'no'}</div>

							<div className="font-medium text-muted-foreground">Project ID</div>
							<div>{logQuery.data.projectId ?? '—'}</div>

							<div className="font-medium text-muted-foreground">Received At</div>
							<div>
								{logQuery.data.receivedAt
									? new Date(logQuery.data.receivedAt).toLocaleString()
									: '—'}
							</div>
						</div>

						<div>
							<div className="mb-1 text-sm font-medium text-muted-foreground">Headers</div>
							<JsonBlock data={logQuery.data.headers} />
						</div>

						<div>
							<div className="mb-1 text-sm font-medium text-muted-foreground">Body</div>
							<JsonBlock data={logQuery.data.body} />
						</div>

						{logQuery.data.bodyRaw && (
							<div>
								<div className="mb-1 text-sm font-medium text-muted-foreground">Raw Body</div>
								<pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-32 whitespace-pre-wrap break-all">
									{logQuery.data.bodyRaw}
								</pre>
							</div>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
