const runningAnalyses = new Set<string>();

export function markAnalysisRunning(runId: string): void {
	runningAnalyses.add(runId);
}

export function markAnalysisComplete(runId: string): void {
	runningAnalyses.delete(runId);
}

export function isAnalysisRunning(runId: string): boolean {
	return runningAnalyses.has(runId);
}
