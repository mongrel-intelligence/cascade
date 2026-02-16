import { cn } from '@/lib/utils.js';

const statusStyles: Record<string, string> = {
	running: 'bg-blue-100 text-blue-700',
	completed: 'bg-green-100 text-green-700',
	failed: 'bg-red-100 text-red-700',
	timed_out: 'bg-amber-100 text-amber-700',
};

export function RunStatusBadge({ status }: { status: string }) {
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
				statusStyles[status] ?? 'bg-gray-100 text-gray-700',
			)}
		>
			{status === 'timed_out' ? 'timed out' : status}
		</span>
	);
}
