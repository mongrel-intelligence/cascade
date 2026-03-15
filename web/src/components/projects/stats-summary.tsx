import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { formatCost, formatDuration } from '@/lib/utils.js';

interface WorkStat {
	agentType: string;
	status: string;
	durationMs: number | null;
	costUsd: string | null;
}

interface StatsSummaryProps {
	stats: WorkStat[];
}

export function StatsSummary({ stats }: StatsSummaryProps) {
	const totalRuns = stats.length;

	const totalCost = stats.reduce((sum, r) => {
		if (r.costUsd != null) {
			const cost = Number.parseFloat(r.costUsd);
			return sum + (Number.isNaN(cost) ? 0 : cost);
		}
		return sum;
	}, 0);

	const completedRuns = stats.filter((r) => r.status === 'completed').length;
	const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;

	const runsWithDuration = stats.filter((r) => r.durationMs != null && r.durationMs > 0);
	const avgDurationMs =
		runsWithDuration.length > 0
			? runsWithDuration.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / runsWithDuration.length
			: null;

	const summaryItems = [
		{
			label: 'Total Runs',
			value: totalRuns >= 500 ? '500+' : String(totalRuns),
		},
		{
			label: 'Total Cost',
			value: formatCost(totalCost.toFixed(4)),
		},
		{
			label: 'Avg Duration',
			value: formatDuration(avgDurationMs != null ? Math.round(avgDurationMs) : null),
		},
		{
			label: 'Success Rate',
			value: totalRuns > 0 ? `${successRate.toFixed(1)}%` : '-',
		},
	];

	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{summaryItems.map((item) => (
				<Card key={item.label}>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							{item.label}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-bold">{item.value}</p>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
