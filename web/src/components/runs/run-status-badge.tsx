import { cn } from '@/lib/utils.js';

const statusStyles: Record<string, string> = {
	running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
	timed_out: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

export function RunStatusBadge({ status }: { status: string }) {
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
				statusStyles[status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
			)}
		>
			{status === 'timed_out' ? 'timed out' : status}
		</span>
	);
}
