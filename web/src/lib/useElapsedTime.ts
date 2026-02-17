import { useEffect, useState } from 'react';

export function useElapsedTime(startedAt: string | null, isRunning: boolean): number | null {
	const [elapsed, setElapsed] = useState<number | null>(null);

	useEffect(() => {
		if (!isRunning || !startedAt) {
			setElapsed(null);
			return;
		}

		const start = new Date(startedAt).getTime();
		const update = () => setElapsed(Date.now() - start);
		update(); // immediate first render
		const id = setInterval(update, 1000);
		return () => clearInterval(id);
	}, [isRunning, startedAt]);

	return elapsed;
}
