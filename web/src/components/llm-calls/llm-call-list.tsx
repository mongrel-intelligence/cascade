import { getToolStyle } from '@/lib/tool-style.js';
import { trpc } from '@/lib/trpc.js';
import { formatCost } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { LlmCallDetail } from './llm-call-detail.js';

interface LlmCallListProps {
	runId: string;
}

type CallMeta = {
	callNumber: number;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedTokens?: number | null;
	costUsd?: string | null;
	durationMs?: number | null;
	model?: string | null;
	createdAt?: Date | string | null;
	toolNames?: string[] | null;
	textPreview?: string | null;
};

function ToolBadges({ toolNames }: { toolNames: string[] }) {
	if (toolNames.length === 0) return null;

	// Count occurrences
	const counts = new Map<string, number>();
	for (const name of toolNames) {
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const unique = [...new Set(toolNames)];

	return (
		<span className="flex flex-wrap gap-1">
			{unique.map((name) => {
				const { bg, text } = getToolStyle(name);
				const count = counts.get(name) ?? 1;
				return (
					<span
						key={name}
						className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${bg} ${text}`}
					>
						{name}
						{count > 1 && <span className="ml-0.5 opacity-70">×{count}</span>}
					</span>
				);
			})}
		</span>
	);
}

function formatDelta(ms: number): string {
	if (ms < 1000) return `+${ms}ms`;
	if (ms < 60_000) return `+${(ms / 1000).toFixed(0)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return s > 0 ? `+${m}m ${s}s` : `+${m}m`;
}

interface CallRowProps {
	runId: string;
	call: CallMeta;
	delta: string | null;
	isExpanded: boolean;
	onToggle: () => void;
}

function CallRow({ runId, call, delta, isExpanded, onToggle }: CallRowProps) {
	return (
		<Fragment>
			<tr
				onClick={onToggle}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') onToggle();
				}}
				tabIndex={0}
				className="cursor-pointer border-b border-border transition-colors hover:bg-muted/30"
			>
				<td className="px-3 py-2 font-mono text-muted-foreground" title={call.model ?? undefined}>
					{call.callNumber}
				</td>
				<td className="px-3 py-2 min-w-0">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<ToolBadges toolNames={call.toolNames ?? []} />
						{call.textPreview && (
							<span className="text-xs text-muted-foreground truncate max-w-xs">
								{call.textPreview}
							</span>
						)}
						{!call.toolNames?.length && !call.textPreview && (
							<span className="text-muted-foreground">—</span>
						)}
					</div>
				</td>
				<td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
					{call.inputTokens?.toLocaleString() ?? '—'}
				</td>
				<td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
					{call.outputTokens?.toLocaleString() ?? '—'}
				</td>
				<td className="hidden md:table-cell px-3 py-2 text-right tabular-nums whitespace-nowrap">
					{formatCost(call.costUsd)}
				</td>
				<td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
					{delta ?? '—'}
				</td>
				<td className="px-2 py-2 text-muted-foreground">
					{isExpanded ? (
						<ChevronDown className="h-3.5 w-3.5" />
					) : (
						<ChevronRight className="h-3.5 w-3.5" />
					)}
				</td>
			</tr>
			{isExpanded && (
				<tr>
					<td colSpan={7} className="p-0">
						<LlmCallDetail runId={runId} callNumber={call.callNumber} />
					</td>
				</tr>
			)}
		</Fragment>
	);
}

export function LlmCallList({ runId }: LlmCallListProps) {
	const [expandedCall, setExpandedCall] = useState<number | null>(null);

	const callsQuery = useQuery(trpc.runs.listLlmCalls.queryOptions({ runId }));

	if (callsQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading LLM calls...</div>;
	}

	if (callsQuery.isError) {
		return <div className="py-8 text-center text-destructive">Failed to load LLM calls</div>;
	}

	const calls = callsQuery.data?.calls ?? [];

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
			{/* Summary stat cards */}
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
					<div className="flex items-baseline justify-between">
						<div className="text-xs text-muted-foreground">Cached</div>
						{totalCachedTokens > 0 && totalTokensIn > 0 && (
							<div className="text-xs text-muted-foreground">
								{((totalCachedTokens / totalTokensIn) * 100).toFixed(0)}%
							</div>
						)}
					</div>
					<div className="text-lg font-semibold">
						{totalCachedTokens > 0 ? totalCachedTokens.toLocaleString() : '—'}
					</div>
				</div>
			</div>

			{/* Cost row */}
			{totalCost > 0 && (
				<div className="text-sm text-muted-foreground">
					Total cost: <span className="font-medium text-foreground">{formatCost(totalCost)}</span>
				</div>
			)}

			{/* Calls table */}
			<div className="overflow-x-auto rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
							<th className="px-3 py-2 text-left font-medium text-muted-foreground">Activity</th>
							<th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
								In
							</th>
							<th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
								Out
							</th>
							<th className="hidden md:table-cell px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
								Cost
							</th>
							<th className="hidden md:table-cell px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
								Δ Time
							</th>
							<th className="w-6" />
						</tr>
					</thead>
					<tbody>
						{calls.map((call, idx) => {
							// Inter-call delta from createdAt
							let delta: string | null = null;
							const prevCreatedAt = calls[idx - 1]?.createdAt;
							if (idx > 0 && call.createdAt && prevCreatedAt) {
								const prev = new Date(prevCreatedAt).getTime();
								const curr = new Date(call.createdAt).getTime();
								const diff = curr - prev;
								if (diff >= 0) delta = formatDelta(diff);
							}

							return (
								<CallRow
									key={call.callNumber}
									runId={runId}
									call={call}
									delta={delta}
									isExpanded={expandedCall === call.callNumber}
									onToggle={() =>
										setExpandedCall(expandedCall === call.callNumber ? null : call.callNumber)
									}
								/>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
