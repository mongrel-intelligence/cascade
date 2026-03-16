import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { formatCostSummary, formatDuration } from '@/lib/utils.js';

interface StatsSummaryProps {
	totalRuns: number;
	totalCostUsd: string;
	avgDurationMs: number | null;
	successRate: number;
}

export function StatsSummary({
	totalRuns,
	totalCostUsd,
	avgDurationMs,
	successRate,
}: StatsSummaryProps) {
	const summaryItems = [
		{
			label: 'Total Runs',
			value: totalRuns >= 500 ? '500+' : String(totalRuns),
		},
		{
			label: 'Total Cost',
			value: formatCostSummary(totalCostUsd),
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
