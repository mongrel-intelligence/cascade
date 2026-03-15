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

interface AgentTypeBreakdown {
	agentType: string;
	runCount: number;
	totalCostUsd: string;
	totalDurationMs: number;
	avgDurationMs: number | null;
}

interface ProjectWorkDurationChartProps {
	byAgentType: AgentTypeBreakdown[];
}

interface ChartEntry {
	name: string;
	agentType: string;
	totalDurationMs: number;
	runCount: number;
	avgDurationMs: number;
	color: string;
}

export function ProjectWorkDurationChart({ byAgentType }: ProjectWorkDurationChartProps) {
	const data: ChartEntry[] = byAgentType
		.filter((breakdown) => breakdown.totalDurationMs > 0)
		.map((breakdown) => ({
			name: agentTypeLabel(breakdown.agentType),
			agentType: breakdown.agentType,
			totalDurationMs: breakdown.totalDurationMs,
			runCount: breakdown.runCount,
			avgDurationMs: breakdown.avgDurationMs ?? 0,
			color: getAgentColor(breakdown.agentType),
		}));

	if (data.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Duration by Agent Type</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="py-8 text-center text-sm text-muted-foreground italic">
						No duration data available
					</p>
				</CardContent>
			</Card>
		);
	}

	const chartHeight = Math.max(200, data.length * 56);
	const formatTick = (value: number) => formatDuration(value);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Duration by Agent Type</CardTitle>
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
						<YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
						<Tooltip
							content={({ active, payload }) => {
								if (!active || !payload?.length) return null;
								const entry = payload[0]?.payload as ChartEntry;
								return (
									<div className="rounded-lg border border-border bg-card p-3 text-sm shadow-md">
										<p className="font-semibold">{entry.name}</p>
										<p className="text-muted-foreground">
											Total: {formatDuration(entry.totalDurationMs)}
										</p>
										<p className="text-muted-foreground">Runs: {entry.runCount}</p>
										<p className="text-muted-foreground">
											Avg: {formatDuration(entry.avgDurationMs)}
										</p>
									</div>
								);
							}}
						/>
						<Legend
							content={() => (
								<div className="flex flex-wrap justify-center gap-3 pt-2" style={{ fontSize: 12 }}>
									{data.map((item) => (
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
											<span>{item.name}</span>
										</div>
									))}
								</div>
							)}
						/>
						<Bar dataKey="totalDurationMs" radius={[0, 4, 4, 0]}>
							{data.map((entry) => (
								<Cell key={entry.agentType} fill={entry.color} />
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
