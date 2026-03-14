import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { agentTypeLabel, getAgentColor } from '@/lib/chart-colors.js';
import { formatDuration } from '@/lib/utils.js';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';

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

interface ChartEntry {
	label: string;
	durationMs: number;
	agentType: string;
	status: string;
	model: string | null;
	costUsd: string | null;
	color: string;
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

	// Build chart data: one entry per run with a duration
	const agentRunCounts: Record<string, number> = {};
	const data: ChartEntry[] = runsWithDuration.map((run) => {
		agentRunCounts[run.agentType] = (agentRunCounts[run.agentType] ?? 0) + 1;
		const count = agentRunCounts[run.agentType];
		return {
			label: `${agentTypeLabel(run.agentType)} #${count}`,
			durationMs: run.durationMs as number,
			agentType: run.agentType,
			status: run.status,
			model: run.model,
			costUsd: run.costUsd,
			color: getAgentColor(run.agentType),
		};
	});

	const chartHeight = Math.max(200, data.length * 48);

	// Unique agent types for legend
	const uniqueAgentTypes = Array.from(new Set(runsWithDuration.map((r) => r.agentType)));

	// Legend items: we render a custom content to show agent type → color
	const legendItems = uniqueAgentTypes.map((at) => ({
		label: agentTypeLabel(at),
		color: getAgentColor(at),
	}));

	const formatTick = (value: number) => formatDuration(value);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Run Durations</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer width="100%" height={chartHeight}>
					<BarChart
						data={data}
						layout="vertical"
						margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
					>
						<CartesianGrid strokeDasharray="3 3" horizontal={false} />
						<XAxis
							type="number"
							tickFormatter={formatTick}
							tick={{ fontSize: 11 }}
							domain={[0, 'auto']}
						/>
						<YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={140} />
						<Tooltip
							content={({ active, payload }) => {
								if (!active || !payload?.length) return null;
								const entry = payload[0]?.payload as ChartEntry;
								return (
									<div className="rounded-lg border border-border bg-card p-3 text-sm shadow-md">
										<p className="font-semibold">{agentTypeLabel(entry.agentType)}</p>
										<p className="text-muted-foreground">
											Duration: {formatDuration(entry.durationMs)}
										</p>
										<p className="text-muted-foreground">Status: {entry.status}</p>
										{entry.model && <p className="text-muted-foreground">Model: {entry.model}</p>}
										{entry.costUsd != null && (
											<p className="text-muted-foreground">
												Cost: ${Number.parseFloat(entry.costUsd).toFixed(4)}
											</p>
										)}
									</div>
								);
							}}
						/>
						<Legend
							content={() => (
								<div className="flex flex-wrap justify-center gap-3 pt-2" style={{ fontSize: 12 }}>
									{legendItems.map((item) => (
										<div key={item.label} className="flex items-center gap-1">
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
							)}
						/>
						<Bar dataKey="durationMs" radius={[0, 4, 4, 0]}>
							{data.map((entry) => (
								<Cell key={entry.label} fill={entry.color} />
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
