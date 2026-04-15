import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

interface RetryRunButtonProps {
	runId: string;
	/** Hide button when status is 'running' */
	status: string;
}

export function RetryRunButton({ runId, status }: RetryRunButtonProps) {
	const queryClient = useQueryClient();

	const retryMutation = useMutation({
		mutationFn: () => trpcClient.runs.retry.mutate({ runId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.runs.list.queryOptions({}).queryKey });
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getById.queryOptions({ id: runId }).queryKey,
			});
		},
	});

	if (status === 'running') {
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
					retryMutation.mutate();
				}}
				disabled={retryMutation.isPending}
				title="Retry run"
			>
				<RefreshCw className="h-4 w-4" />
			</Button>
			{retryMutation.isError && (
				<span
					className="text-xs text-destructive"
					title={
						retryMutation.error instanceof Error ? retryMutation.error.message : 'Retry failed'
					}
				>
					Failed
				</span>
			)}
		</span>
	);
}
