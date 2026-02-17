import { useElapsedTime } from '@/lib/useElapsedTime.js';
import { formatDuration } from '@/lib/utils.js';

interface LiveDurationProps {
	startedAt: string | null;
	durationMs: number | null;
	status: string;
}

export function LiveDuration({ startedAt, durationMs, status }: LiveDurationProps) {
	const elapsed = useElapsedTime(startedAt, status === 'running');
	return <>{formatDuration(elapsed ?? durationMs)}</>;
}
