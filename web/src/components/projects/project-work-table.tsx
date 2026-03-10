import { CancelRunButton } from '@/components/runs/cancel-run-button.js';
import { LiveDuration } from '@/components/runs/live-duration.js';
import { RetryRunButton } from '@/components/runs/retry-run-button.js';
import { RunStatusBadge } from '@/components/runs/run-status-badge.js';
import { trpc } from '@/lib/trpc.js';
import { formatCost, formatRelativeTime } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	ChevronDown,
	ChevronRight,
	ClipboardList,
	ExternalLink,
	GitPullRequest,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface WorkItem {
	id: string;
	type: 'pr' | 'linked' | 'work-item';
	prNumber: number | null;
	repoFullName: string | null;
	prUrl: string | null;
	prTitle: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	runCount: number;
	updatedAt: Date | string | null;
	totalCostUsd: string | number | null;
}

interface ProjectWorkTableProps {
	items: WorkItem[];
	projectId: string;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
}

// ============================================================================
// ExpandedRunsRow sub-component
// ============================================================================

interface ExpandedRunsRowProps {
	projectId: string;
	prNumber: number | null;
	workItemId: string | null;
}

function ExpandedRunsRow({ projectId, prNumber, workItemId }: ExpandedRunsRowProps) {
	const runsQuery = useQuery(
		workItemId
			? trpc.workItems.runs.queryOptions({ projectId, workItemId })
			: prNumber !== null
				? trpc.prs.runs.queryOptions({ projectId, prNumber })
				: trpc.workItems.runs.queryOptions({ projectId, workItemId: '' }),
	);

	return (
		<tr>
			<td colSpan={4} className="border-t border-border bg-muted/20 px-4 py-3">
				{runsQuery.isLoading && (
					<div className="text-sm text-muted-foreground">Loading runs...</div>
				)}
				{runsQuery.isError && (
					<div className="text-sm text-destructive">
						Failed to load runs: {runsQuery.error.message}
					</div>
				)}
				{runsQuery.data && runsQuery.data.length === 0 && (
					<div className="text-sm text-muted-foreground italic">No runs found</div>
				)}
				{runsQuery.data && runsQuery.data.length > 0 && (
					<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead>
								<tr className="border-b border-border">
									<th className="pb-2 pr-4 text-left font-medium text-muted-foreground">Agent</th>
									<th className="pb-2 pr-4 text-left font-medium text-muted-foreground">Status</th>
									<th className="pb-2 pr-4 text-left font-medium text-muted-foreground">Started</th>
									<th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
										Duration
									</th>
									<th className="pb-2 pr-4 text-right font-medium text-muted-foreground">Cost</th>
									<th className="pb-2 pr-4 text-right font-medium text-muted-foreground">Iters</th>
									<th className="pb-2 text-center font-medium text-muted-foreground">Actions</th>
								</tr>
							</thead>
							<tbody>
								{runsQuery.data.map((run) => (
									<tr key={run.id} className="border-b border-border/50 last:border-0">
										<td className="py-1.5 pr-4">
											<Link
												to="/runs/$runId"
												params={{ runId: run.id }}
												className="font-medium text-primary hover:underline"
											>
												{run.agentType}
											</Link>
										</td>
										<td className="py-1.5 pr-4">
											<RunStatusBadge status={run.status} />
										</td>
										<td className="py-1.5 pr-4 text-muted-foreground">
											{formatRelativeTime(run.startedAt)}
										</td>
										<td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
											<LiveDuration
												startedAt={run.startedAt}
												durationMs={run.durationMs}
												status={run.status}
											/>
										</td>
										<td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
											{formatCost(run.costUsd)}
										</td>
										<td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
											{run.llmIterations ?? '-'}
										</td>
										<td className="py-1.5 text-center">
											<CancelRunButton runId={run.id} status={run.status} />
											<RetryRunButton runId={run.id} status={run.status} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</td>
		</tr>
	);
}

// ============================================================================
// WorkItemRow sub-component (extracted to reduce complexity)
// ============================================================================

interface WorkItemRowProps {
	item: WorkItem;
	isExpanded: boolean;
	onToggle: (id: string) => void;
}

function WorkItemRow({ item, isExpanded, onToggle }: WorkItemRowProps) {
	const canExpand = item.runCount > 0;

	const handleClick = () => {
		if (canExpand) onToggle(item.id);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onToggle(item.id);
		}
	};

	return (
		<tr
			className="border-b border-border transition-colors hover:bg-muted/30"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			style={canExpand ? { cursor: 'pointer' } : undefined}
		>
			{/* Expand chevron / Type icon */}
			<td className="px-4 py-3 text-muted-foreground">
				{canExpand ? (
					isExpanded ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)
				) : item.type === 'linked' ? (
					<span title="Linked (PR + Work Item)">
						<ClipboardList className="h-4 w-4" />
					</span>
				) : item.type === 'work-item' ? (
					<span title="Work Item">
						<ClipboardList className="h-4 w-4" />
					</span>
				) : (
					<span title="Pull Request">
						<GitPullRequest className="h-4 w-4" />
					</span>
				)}
			</td>

			{/* PR title / number + Associated work item (stacked) */}
			<td className="px-4 py-3">
				<div className="flex flex-col gap-1">
					{/* Primary row: work item title (for work-item type) or PR title */}
					{item.type === 'work-item' ? (
						item.workItemUrl && item.workItemTitle ? (
							<a
								href={item.workItemUrl}
								target="_blank"
								rel="noopener noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="inline-flex items-center gap-1 text-primary hover:underline"
							>
								{item.workItemTitle}
								<ExternalLink className="h-3 w-3 shrink-0" />
							</a>
						) : item.workItemTitle ? (
							<span>{item.workItemTitle}</span>
						) : (
							<span className="text-muted-foreground italic">No title</span>
						)
					) : item.prUrl ? (
						<a
							href={item.prUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="inline-flex items-center gap-1 text-primary hover:underline"
						>
							#{item.prNumber}
							{item.prTitle && <span className="ml-1 text-foreground">{item.prTitle}</span>}
							<ExternalLink className="h-3 w-3 shrink-0" />
						</a>
					) : (
						<span className="text-muted-foreground">
							#{item.prNumber}
							{item.prTitle && <span className="ml-1 text-foreground">{item.prTitle}</span>}
						</span>
					)}

					{/* Secondary row: "No PR yet" for work-item, or associated work item for linked */}
					{item.type === 'work-item' ? (
						<span className="text-xs text-muted-foreground italic">No PR yet</span>
					) : item.type === 'linked' && item.workItemTitle ? (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<ClipboardList className="h-3 w-3 shrink-0" />
							{item.workItemUrl ? (
								<a
									href={item.workItemUrl}
									target="_blank"
									rel="noopener noreferrer"
									onClick={(e) => e.stopPropagation()}
									className="inline-flex items-center gap-1 hover:underline hover:text-primary"
								>
									{item.workItemTitle}
									<ExternalLink className="h-3 w-3 shrink-0" />
								</a>
							) : (
								<span>{item.workItemTitle}</span>
							)}
						</span>
					) : null}
				</div>
			</td>

			{/* Run count */}
			<td className="px-4 py-3 text-right tabular-nums">
				{canExpand ? (
					<span className="cursor-pointer text-primary hover:underline">{item.runCount}</span>
				) : (
					item.runCount
				)}
			</td>

			{/* Cost */}
			<td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
				{formatCost(item.totalCostUsd)}
			</td>
		</tr>
	);
}

// ============================================================================
// Main ProjectWorkTable component
// ============================================================================

export function ProjectWorkTable({
	items,
	projectId,
	offset,
	limit,
	onPageChange,
}: ProjectWorkTableProps) {
	const total = items.length;
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;
	const pageItems = items.slice(offset, offset + limit);

	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

	// Reset expanded rows when the page changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: offset is a prop used as a page-change trigger
	useEffect(() => {
		setExpandedRows(new Set());
	}, [offset]);

	const toggleRow = (id: string) => {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground w-8" />
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								Title / Associated Item
							</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Runs</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
						</tr>
					</thead>
					<tbody>
						{pageItems.length === 0 && (
							<tr>
								<td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
									No work found for this project
								</td>
							</tr>
						)}
						{pageItems.map((item) => (
							<React.Fragment key={item.id}>
								<WorkItemRow
									item={item}
									isExpanded={expandedRows.has(item.id)}
									onToggle={toggleRow}
								/>
								{expandedRows.has(item.id) && (
									<ExpandedRunsRow
										projectId={projectId}
										prNumber={item.prNumber}
										workItemId={item.workItemId}
									/>
								)}
							</React.Fragment>
						))}
					</tbody>
				</table>
			</div>

			{total > limit && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-sm text-muted-foreground">
						Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => onPageChange(Math.max(0, offset - limit))}
							disabled={offset === 0}
							className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
						>
							Previous
						</button>
						<span className="inline-flex h-8 items-center px-2 text-sm text-muted-foreground">
							Page {currentPage} of {totalPages}
						</span>
						<button
							type="button"
							onClick={() => onPageChange(offset + limit)}
							disabled={offset + limit >= total}
							className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
						>
							Next
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
