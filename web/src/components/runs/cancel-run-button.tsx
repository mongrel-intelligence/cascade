import { Button } from '@/components/ui/button.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square } from 'lucide-react';

interface CancelRunButtonProps {
	runId: string;
	/** Only show button when status is 'running' */
	status: string;
}

export function CancelRunButton({ runId, status }: CancelRunButtonProps) {
	const queryClient = useQueryClient();

	const cancelMutation = useMutation({
		mutationFn: () => trpcClient.runs.cancel.mutate({ runId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.runs.list.queryOptions({}).queryKey });
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getById.queryOptions({ id: runId }).queryKey,
			});
		},
	});

	if (status !== 'running') {
		return null;
	}

	return (
		<span className="inline-flex items-center gap-1">
			<Button
				variant="outline"
				size="sm"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (window.confirm('Cancel this run?')) {
						cancelMutation.mutate();
					}
				}}
				disabled={cancelMutation.isPending}
				title="Cancel run"
				className="text-destructive hover:text-destructive"
			>
				<Square className="h-4 w-4" />
			</Button>
			{cancelMutation.isError && (
				<span
					className="text-xs text-destructive"
					title={
						cancelMutation.error instanceof Error ? cancelMutation.error.message : 'Cancel failed'
					}
				>
					Failed
				</span>
			)}
		</span>
	);
}
