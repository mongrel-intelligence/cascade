import { Link } from '@tanstack/react-router';
import { Activity, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { formatCost, formatRelativeTime } from '@/lib/utils.js';
import { CancelRunButton } from './cancel-run-button.js';
import { LiveDuration } from './live-duration.js';
import { RetryRunButton } from './retry-run-button.js';
import { RunStatusBadge } from './run-status-badge.js';

interface Run {
	id: string;
	projectId?: string | null;
	projectName: string | null;
	orgName?: string | null;
	agentType: string;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	costUsd: string | null;
	llmIterations: number | null;
	prUrl: string | null;
	prNumber?: number | null;
	workItemId?: string | null;
	workItemTitle?: string | null;
	workItemUrl?: string | null;
}

interface RunsTableProps {
	runs: Run[];
	total: number;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
	showOrg?: boolean;
}

export function RunsTable({
	runs,
	total,
	offset,
	limit,
	onPageChange,
	showOrg = false,
}: RunsTableProps) {
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead className="px-4 py-3">Agent</TableHead>
							{showOrg && (
								<TableHead className="hidden px-4 py-3 md:table-cell">Organization</TableHead>
							)}
							<TableHead className="hidden px-4 py-3 md:table-cell">Project</TableHead>
							<TableHead className="hidden px-4 py-3 md:table-cell">Work Item</TableHead>
							<TableHead className="px-4 py-3">Status</TableHead>
							<TableHead className="px-4 py-3">Started</TableHead>
							<TableHead className="hidden px-4 py-3 text-right md:table-cell">Duration</TableHead>
							<TableHead className="hidden px-4 py-3 text-right md:table-cell">Cost</TableHead>
							<TableHead className="hidden px-4 py-3 text-right md:table-cell">
								Iterations
							</TableHead>
							<TableHead className="hidden px-4 py-3 text-center md:table-cell">PR</TableHead>
							<TableHead className="px-4 py-3 text-center">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{runs.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={showOrg ? 11 : 10}
									className="px-4 py-12 text-center whitespace-normal text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Activity className="h-8 w-8 text-muted-foreground/50" />
										<p className="font-medium">No runs yet</p>
										<p className="text-sm text-muted-foreground">
											Runs appear here when CASCADE processes work items.
										</p>
									</div>
								</TableCell>
							</TableRow>
						)}
						{runs.map((run) => (
							<TableRow key={run.id}>
								<TableCell className="px-4 py-3">
									<Link
										to="/runs/$runId"
										params={{ runId: run.id }}
										className="font-medium text-primary hover:underline"
									>
										{run.agentType}
									</Link>
								</TableCell>
								{showOrg && (
									<TableCell className="hidden px-4 py-3 text-muted-foreground md:table-cell">
										{run.orgName ?? '-'}
									</TableCell>
								)}
								<TableCell className="hidden px-4 py-3 text-muted-foreground md:table-cell">
									{run.projectName ?? '-'}
								</TableCell>
								<TableCell className="hidden px-4 py-3 whitespace-normal md:table-cell">
									{run.workItemUrl && run.workItemTitle ? (
										<div className="flex flex-col gap-0.5">
											<a
												href={run.workItemUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-primary hover:underline"
											>
												{run.workItemTitle}
												<ExternalLink className="h-3 w-3 shrink-0" />
											</a>
											{run.projectId && run.workItemId && (
												<Link
													to="/work-items/$projectId/$workItemId"
													params={{
														projectId: run.projectId,
														workItemId: run.workItemId,
													}}
													className="text-xs text-muted-foreground hover:text-primary hover:underline"
												>
													View all runs
												</Link>
											)}
										</div>
									) : run.workItemId && run.projectId ? (
										<div className="flex flex-col gap-0.5">
											<Badge variant="outline">Unlinked</Badge>
											<Link
												to="/work-items/$projectId/$workItemId"
												params={{
													projectId: run.projectId,
													workItemId: run.workItemId,
												}}
												className="text-xs text-muted-foreground hover:text-primary hover:underline"
											>
												View all runs
											</Link>
										</div>
									) : (
										<Badge variant="outline">Unlinked</Badge>
									)}
								</TableCell>
								<TableCell className="px-4 py-3">
									<RunStatusBadge status={run.status} />
								</TableCell>
								<TableCell className="px-4 py-3 text-muted-foreground">
									{formatRelativeTime(run.startedAt)}
								</TableCell>
								<TableCell className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
									<LiveDuration
										startedAt={run.startedAt}
										durationMs={run.durationMs}
										status={run.status}
									/>
								</TableCell>
								<TableCell className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
									{formatCost(run.costUsd)}
								</TableCell>
								<TableCell className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
									{run.llmIterations ?? '-'}
								</TableCell>
								<TableCell className="hidden px-4 py-3 text-center md:table-cell">
									{run.prUrl ? (
										<div className="flex flex-col items-center gap-0.5">
											<a
												href={run.prUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center text-muted-foreground hover:text-foreground"
											>
												<ExternalLink className="h-4 w-4" />
											</a>
											{run.projectId && run.prNumber != null && (
												<Link
													to="/prs/$projectId/$prNumber"
													params={{
														projectId: run.projectId,
														prNumber: String(run.prNumber),
													}}
													className="text-xs text-muted-foreground hover:text-primary hover:underline"
												>
													View all runs
												</Link>
											)}
										</div>
									) : (
										'-'
									)}
								</TableCell>
								<TableCell className="px-4 py-3 text-center">
									<CancelRunButton runId={run.id} status={run.status} />
									<RetryRunButton runId={run.id} status={run.status} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{total > limit && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
