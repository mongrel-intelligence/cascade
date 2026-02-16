import { trpc } from '@/lib/trpc.js';
import { formatCost, formatDuration } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LlmCallDetail } from './llm-call-detail.js';

interface LlmCallListProps {
	runId: string;
}

export function LlmCallList({ runId }: LlmCallListProps) {
	const [expandedCall, setExpandedCall] = useState<number | null>(null);

	const callsQuery = useQuery(trpc.runs.listLlmCalls.queryOptions({ runId }));

	if (callsQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading LLM calls...</div>;
	}

	const calls = callsQuery.data ?? [];

	if (calls.length === 0) {
		return <div className="py-8 text-center text-muted-foreground">No LLM calls recorded</div>;
	}

	const totalTokensIn = calls.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0);
	const totalTokensOut = calls.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0);
	const totalCachedTokens = calls.reduce((sum, c) => sum + (c.cachedTokens ?? 0), 0);
	const totalCost = calls.reduce(
		(sum, c) => sum + (c.costUsd ? Number.parseFloat(c.costUsd) : 0),
		0,
	);

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div className="rounded-lg border border-border p-3">
					<div className="text-xs text-muted-foreground">Total Calls</div>
					<div className="text-lg font-semibold">{calls.length}</div>
				</div>
				<div className="rounded-lg border border-border p-3">
					<div className="text-xs text-muted-foreground">Input Tokens</div>
					<div className="text-lg font-semibold">{totalTokensIn.toLocaleString()}</div>
				</div>
				<div className="rounded-lg border border-border p-3">
					<div className="text-xs text-muted-foreground">Output Tokens</div>
					<div className="text-lg font-semibold">{totalTokensOut.toLocaleString()}</div>
				</div>
				<div className="rounded-lg border border-border p-3">
					<div className="text-xs text-muted-foreground">Total Cost</div>
					<div className="text-lg font-semibold">{formatCost(totalCost)}</div>
				</div>
			</div>

			<div className="overflow-hidden rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-4 py-2 text-left font-medium text-muted-foreground">#</th>
							<th className="px-4 py-2 text-right font-medium text-muted-foreground">
								Input Tokens
							</th>
							<th className="px-4 py-2 text-right font-medium text-muted-foreground">
								Output Tokens
							</th>
							<th className="px-4 py-2 text-right font-medium text-muted-foreground">Cached</th>
							<th className="px-4 py-2 text-right font-medium text-muted-foreground">Cost</th>
							<th className="px-4 py-2 text-right font-medium text-muted-foreground">Duration</th>
						</tr>
					</thead>
					<tbody>
						{calls.map((call) => (
							<>
								<tr
									key={call.callNumber}
									onClick={() =>
										setExpandedCall(expandedCall === call.callNumber ? null : call.callNumber)
									}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ')
											setExpandedCall(expandedCall === call.callNumber ? null : call.callNumber);
									}}
									className="cursor-pointer border-b border-border transition-colors hover:bg-muted/30"
								>
									<td className="px-4 py-2 font-mono">{call.callNumber}</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{call.inputTokens?.toLocaleString() ?? '-'}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{call.outputTokens?.toLocaleString() ?? '-'}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{call.cachedTokens?.toLocaleString() ?? '-'}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">{formatCost(call.costUsd)}</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{formatDuration(call.durationMs)}
									</td>
								</tr>
								{expandedCall === call.callNumber && (
									<tr key={`${call.callNumber}-detail`}>
										<td colSpan={6} className="p-0">
											<LlmCallDetail runId={runId} callNumber={call.callNumber} />
										</td>
									</tr>
								)}
							</>
						))}
					</tbody>
				</table>
			</div>

			{totalCachedTokens > 0 && (
				<div className="text-sm text-muted-foreground">
					Cache hit rate: {((totalCachedTokens / totalTokensIn) * 100).toFixed(1)}% of input tokens
				</div>
			)}
		</div>
	);
}
