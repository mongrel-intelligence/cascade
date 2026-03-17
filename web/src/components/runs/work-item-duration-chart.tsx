import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { agentTypeLabel, getAgentColor } from '@/lib/chart-colors.js';
import { formatDuration } from '@/lib/utils.js';

interface WorkItemRun {
	id: string;
	agentType: string;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	costUsd: string | null;
	model: string | null;
}

interface WorkItemDurationChartProps {
	runs: WorkItemRun[];
}

interface SegmentEntry {
	id: string;
	label: string;
	durationMs: number;
	agentType: string;
	status: string;
	model: string | null;
	costUsd: string | null;
	color: string;
	pct: number;
}

export function WorkItemDurationChart({ runs }: WorkItemDurationChartProps) {
	const runsWithDuration = runs.filter((r) => r.durationMs != null && r.durationMs > 0);

	if (runsWithDuration.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Run Durations</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="py-8 text-center text-sm text-muted-foreground italic">
						No duration data available
					</p>
				</CardContent>
			</Card>
		);
	}

	const totalMs = runsWithDuration.reduce((sum, r) => sum + (r.durationMs as number), 0);

	// Build segments: one per run
	const agentRunCounts: Record<string, number> = {};
	const segments: SegmentEntry[] = runsWithDuration.map((run) => {
		agentRunCounts[run.agentType] = (agentRunCounts[run.agentType] ?? 0) + 1;
		const count = agentRunCounts[run.agentType];
		const durationMs = run.durationMs as number;
		return {
			id: run.id,
			label: `${agentTypeLabel(run.agentType)} #${count}`,
			durationMs,
			agentType: run.agentType,
			status: run.status,
			model: run.model,
			costUsd: run.costUsd,
			color: getAgentColor(run.agentType),
			pct: totalMs > 0 ? (durationMs / totalMs) * 100 : 0,
		};
	});

	// Unique agent types for legend
	const uniqueAgentTypes = Array.from(new Set(runsWithDuration.map((r) => r.agentType)));
	const legendItems = uniqueAgentTypes.map((at) => ({
		agentType: at,
		label: agentTypeLabel(at),
		color: getAgentColor(at),
	}));

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Run Durations</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Horizontal stacked bar */}
				<div className="flex h-8 w-full overflow-hidden rounded-md">
					{segments.map((seg) => (
						<div
							key={seg.id}
							style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
							title={`${seg.label}: ${formatDuration(seg.durationMs)}${seg.model ? ` · ${seg.model}` : ''}${seg.costUsd != null ? ` · $${Number.parseFloat(seg.costUsd).toFixed(4)}` : ''} · ${seg.status}`}
							className="cursor-default transition-opacity hover:opacity-80"
						/>
					))}
				</div>

				{/* Legend */}
				<div className="flex flex-wrap gap-3" style={{ fontSize: 12 }}>
					{legendItems.map((item) => (
						<div key={item.agentType} className="flex items-center gap-1">
							<span
								style={{
									display: 'inline-block',
									width: 12,
									height: 12,
									borderRadius: 2,
									background: item.color,
								}}
							/>
							<span>{item.label}</span>
						</div>
					))}
				</div>

				{/* Segment detail list */}
				<div className="space-y-1">
					{segments.map((seg) => (
						<div key={seg.id} className="flex items-center gap-2 text-xs text-muted-foreground">
							<span
								style={{
									display: 'inline-block',
									width: 8,
									height: 8,
									borderRadius: 2,
									background: seg.color,
									flexShrink: 0,
								}}
							/>
							<span className="font-medium text-foreground">{seg.label}</span>
							<span>{formatDuration(seg.durationMs)}</span>
							<span>·</span>
							<span>{seg.status}</span>
							{seg.model && (
								<>
									<span>·</span>
									<span>{seg.model}</span>
								</>
							)}
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
