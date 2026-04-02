import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { agentTypeLabel, getAgentColor } from '@/lib/chart-colors.js';
import { formatCostSummary } from '@/lib/utils.js';

interface WorkItemRun {
	id: string;
	agentType: string;
	costUsd: string | null;
}

interface AgentTypeBreakdown {
	agentType: string;
	runCount: number;
	totalCostUsd: string;
	totalDurationMs: number;
	avgDurationMs: number | null;
}

type WorkItemCostChartProps =
	| { runs: WorkItemRun[]; byAgentType?: never }
	| { byAgentType: AgentTypeBreakdown[]; runs?: never };

interface CostEntry {
	name: string;
	agentType: string;
	value: number;
	color: string;
}

function buildDataFromRuns(runs: WorkItemRun[]): CostEntry[] {
	const costByAgent: Record<string, number> = {};
	for (const run of runs) {
		if (run.costUsd != null) {
			const cost = Number.parseFloat(run.costUsd);
			if (!Number.isNaN(cost) && cost > 0) {
				costByAgent[run.agentType] = (costByAgent[run.agentType] ?? 0) + cost;
			}
		}
	}
	return Object.entries(costByAgent).map(([agentType, value]) => ({
		name: agentTypeLabel(agentType),
		agentType,
		value,
		color: getAgentColor(agentType),
	}));
}

function buildDataFromBreakdown(byAgentType: AgentTypeBreakdown[]): CostEntry[] {
	return byAgentType
		.map((breakdown) => {
			const cost = Number.parseFloat(breakdown.totalCostUsd);
			return {
				name: agentTypeLabel(breakdown.agentType),
				agentType: breakdown.agentType,
				value: Number.isNaN(cost) ? 0 : cost,
				color: getAgentColor(breakdown.agentType),
			};
		})
		.filter((entry) => entry.value > 0);
}

export function WorkItemCostChart({ runs, byAgentType }: WorkItemCostChartProps) {
	const data: CostEntry[] = byAgentType
		? buildDataFromBreakdown(byAgentType)
		: buildDataFromRuns(runs ?? []);

	const totalCost = data.reduce((sum, d) => sum + d.value, 0);

	if (data.length === 0 || totalCost === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Cost by Agent Type</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="py-8 text-center text-sm text-muted-foreground italic">
						No cost data available
					</p>
				</CardContent>
			</Card>
		);
	}

	const totalLabel = formatCostSummary(totalCost);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Cost by Agent Type</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer width="100%" height={240}>
					<PieChart>
						<Pie
							data={data}
							dataKey="value"
							nameKey="name"
							cx="50%"
							cy="50%"
							innerRadius={60}
							outerRadius={90}
							paddingAngle={2}
						>
							{data.map((entry) => (
								<Cell key={entry.agentType} fill={entry.color} />
							))}
							<Label
								value={totalLabel}
								position="center"
								style={{ fontSize: 14, fontWeight: 600, fill: 'currentColor' }}
							/>
						</Pie>
						<Tooltip
							content={({ active, payload }) => {
								if (!active || !payload?.length) return null;
								const entry = payload[0]?.payload as CostEntry;
								const pct = totalCost > 0 ? ((entry.value / totalCost) * 100).toFixed(1) : '0';
								return (
									<div className="rounded-lg border border-border bg-card p-3 text-sm shadow-md">
										<p className="font-semibold">{entry.name}</p>
										<p className="text-muted-foreground">Cost: ${entry.value.toFixed(4)}</p>
										<p className="text-muted-foreground">{pct}% of total</p>
									</div>
								);
							}}
						/>
						<Legend formatter={(value) => <span style={{ fontSize: 12 }}>{value}</span>} />
					</PieChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
