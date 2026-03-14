import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.js';
import { Button } from '@/components/ui/button.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CancelRunButtonProps {
	runId: string;
	/** Only show button when status is 'running' */
	status: string;
}

export function CancelRunButton({ runId, status }: CancelRunButtonProps) {
	const queryClient = useQueryClient();
	const [showDialog, setShowDialog] = useState(false);
	const [showSuccess, setShowSuccess] = useState(false);

	const cancelMutation = useMutation({
		mutationFn: () => trpcClient.runs.cancel.mutate({ runId }),
		onSuccess: () => {
			setShowSuccess(true);
			queryClient.invalidateQueries({ queryKey: trpc.runs.list.queryOptions({}).queryKey });
			queryClient.invalidateQueries({
				queryKey: trpc.runs.getById.queryOptions({ id: runId }).queryKey,
			});
		},
	});

	// Auto-dismiss success indicator after 2 seconds
	useEffect(() => {
		if (showSuccess) {
			const timer = setTimeout(() => {
				setShowSuccess(false);
			}, 2000);
			return () => clearTimeout(timer);
		}
	}, [showSuccess]);

	if (status !== 'running') {
		return null;
	}

	return (
		<>
			<AlertDialog open={showDialog} onOpenChange={setShowDialog}>
				<span className="inline-flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							setShowDialog(true);
						}}
						disabled={cancelMutation.isPending || showSuccess}
						title="Cancel run"
						className="text-destructive hover:text-destructive"
					>
						{cancelMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : showSuccess ? (
							<CheckCircle className="h-4 w-4" />
						) : (
							<Square className="h-4 w-4" />
						)}
					</Button>
					{showSuccess && !cancelMutation.isPending && (
						<span className="text-xs text-green-600 dark:text-green-400">Cancelled</span>
					)}
					{cancelMutation.isError && !showSuccess && (
						<span
							className="text-xs text-destructive"
							title={
								cancelMutation.error instanceof Error
									? cancelMutation.error.message
									: 'Cancel failed'
							}
						>
							{cancelMutation.error instanceof Error
								? `Error: ${cancelMutation.error.message}`
								: 'Failed'}
						</span>
					)}
				</span>

				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel Run</AlertDialogTitle>
						<AlertDialogDescription>
							This will terminate the worker container. Are you sure?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								cancelMutation.mutate();
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Terminate
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
