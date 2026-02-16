import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface DebugAnalysisProps {
	runId: string;
}

function Section({ title, content }: { title: string; content: string | null | undefined }) {
	if (!content) return null;
	return (
		<div className="rounded-lg border border-border p-4">
			<h3 className="mb-2 text-sm font-semibold">{title}</h3>
			<pre className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</pre>
		</div>
	);
}

export function DebugAnalysis({ runId }: DebugAnalysisProps) {
	const analysisQuery = useQuery(trpc.runs.getDebugAnalysis.queryOptions({ runId }));

	if (analysisQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading analysis...</div>;
	}

	if (!analysisQuery.data) {
		return (
			<div className="py-8 text-center text-muted-foreground">
				No debug analysis available for this run
			</div>
		);
	}

	const analysis = analysisQuery.data;

	return (
		<div className="space-y-4">
			{analysis.severity && (
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">Severity:</span>
					<span className="text-sm font-medium">{analysis.severity}</span>
				</div>
			)}
			<Section title="Summary" content={analysis.summary} />
			<Section title="Issues" content={analysis.issues} />
			<Section title="Root Cause" content={analysis.rootCause} />
			<Section title="Timeline" content={analysis.timeline} />
			<Section title="Recommendations" content={analysis.recommendations} />
		</div>
	);
}
