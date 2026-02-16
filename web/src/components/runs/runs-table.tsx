import { formatCost, formatDuration, formatRelativeTime } from '@/lib/utils.js';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { RunStatusBadge } from './run-status-badge.js';

interface Run {
	id: string;
	projectName: string | null;
	agentType: string;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	costUsd: string | null;
	llmIterations: number | null;
	prUrl: string | null;
}

interface RunsTableProps {
	runs: Run[];
	total: number;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
}

export function RunsTable({ runs, total, offset, limit, onPageChange }: RunsTableProps) {
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Agent</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Project</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Duration</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Iterations</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">PR</th>
						</tr>
					</thead>
					<tbody>
						{runs.length === 0 && (
							<tr>
								<td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
									No runs found
								</td>
							</tr>
						)}
						{runs.map((run) => (
							<tr
								key={run.id}
								className="border-b border-border transition-colors hover:bg-muted/30"
							>
								<td className="px-4 py-3">
									<Link
										to="/runs/$runId"
										params={{ runId: run.id }}
										className="font-medium text-primary hover:underline"
									>
										{run.agentType}
									</Link>
								</td>
								<td className="px-4 py-3 text-muted-foreground">{run.projectName ?? '-'}</td>
								<td className="px-4 py-3">
									<RunStatusBadge status={run.status} />
								</td>
								<td className="px-4 py-3 text-muted-foreground">
									{formatRelativeTime(run.startedAt)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums">
									{formatDuration(run.durationMs)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums">{formatCost(run.costUsd)}</td>
								<td className="px-4 py-3 text-right tabular-nums">{run.llmIterations ?? '-'}</td>
								<td className="px-4 py-3 text-center">
									{run.prUrl ? (
										<a
											href={run.prUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center text-muted-foreground hover:text-foreground"
										>
											<ExternalLink className="h-4 w-4" />
										</a>
									) : (
										'-'
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{total > limit && (
				<div className="flex items-center justify-between">
					<div className="text-sm text-muted-foreground">
						Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
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
