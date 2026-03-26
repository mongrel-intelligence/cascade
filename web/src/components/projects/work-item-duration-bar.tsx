import { agentTypeLabel, getAgentColor } from '@/lib/chart-colors.js';
import { formatDuration } from '@/lib/utils.js';

export interface RunSegmentInput {
	agentType: string;
	durationMs: number;
	status: string;
}

export interface DurationSegment {
	agentType: string;
	durationMs: number;
	status: string;
	color: string;
	pct: number;
	label: string;
}

/**
 * Pure function that converts an array of run breakdowns into display segments
 * suitable for rendering a horizontal stacked bar.
 *
 * Exported for testability.
 */
export function buildDurationSegments(runs: RunSegmentInput[]): DurationSegment[] {
	const runsWithDuration = runs.filter((r) => r.durationMs > 0);
	if (runsWithDuration.length === 0) return [];

	const totalMs = runsWithDuration.reduce((sum, r) => sum + r.durationMs, 0);

	const agentRunCounts: Record<string, number> = {};
	return runsWithDuration.map((run) => {
		agentRunCounts[run.agentType] = (agentRunCounts[run.agentType] ?? 0) + 1;
		const count = agentRunCounts[run.agentType];
		return {
			agentType: run.agentType,
			durationMs: run.durationMs,
			status: run.status,
			color: getAgentColor(run.agentType),
			pct: totalMs > 0 ? (run.durationMs / totalMs) * 100 : 0,
			label: `${agentTypeLabel(run.agentType)} #${count}`,
		};
	});
}

interface WorkItemDurationBarProps {
	runs: RunSegmentInput[];
	projectAvgDurationMs: number | null;
}

/**
 * Compact inline horizontal stacked bar showing run durations by agent type.
 * Highlights in red when total > 2× project average (outlier).
 */
export function WorkItemDurationBar({ runs, projectAvgDurationMs }: WorkItemDurationBarProps) {
	const segments = buildDurationSegments(runs);

	if (segments.length === 0) {
		return <span className="text-xs text-muted-foreground">—</span>;
	}

	const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
	const isOutlier = projectAvgDurationMs != null && totalMs > 2 * projectAvgDurationMs;

	return (
		<div className="flex items-center gap-2 min-w-[120px]">
			{/* Stacked bar */}
			<div
				className={`flex h-4 w-full overflow-hidden rounded-sm ${isOutlier ? 'ring-1 ring-red-500/60' : ''}`}
				style={{ minWidth: 80 }}
			>
				{segments.map((seg, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable id
						key={i}
						style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
						title={`${seg.label}: ${formatDuration(seg.durationMs)} · ${seg.status}`}
						className="cursor-default transition-opacity hover:opacity-80"
					/>
				))}
			</div>

			{/* Total duration label */}
			<span
				className={`text-xs tabular-nums whitespace-nowrap ${isOutlier ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}
				title={
					isOutlier
						? `Outlier: ${formatDuration(totalMs)} > 2× project avg (${formatDuration(projectAvgDurationMs)})`
						: undefined
				}
			>
				{formatDuration(totalMs)}
			</span>
		</div>
	);
}
