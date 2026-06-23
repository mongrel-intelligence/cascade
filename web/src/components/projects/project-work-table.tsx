import { useNavigate } from '@tanstack/react-router';
import { ClipboardList, ExternalLink, GitPullRequest } from 'lucide-react';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { agentTypeLabel } from '@/lib/chart-colors.js';
import { useChartColors } from '@/lib/use-chart-colors.js';
import { formatCostSummary } from '@/lib/utils.js';
import { WorkItemDurationBar } from './work-item-duration-bar.js';

interface WorkItemRun {
	agentType: string;
	durationMs: number;
	status: string;
}

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
	runs?: WorkItemRun[];
}

interface ProjectWorkTableProps {
	items: WorkItem[];
	projectId: string;
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
	projectAvgDurationMs?: number | null;
}

// ============================================================================
// WorkItemRow sub-component (extracted to reduce complexity)
// ============================================================================

interface WorkItemRowProps {
	item: WorkItem;
	projectId: string;
	projectAvgDurationMs?: number | null;
}

function ItemIcon({ item }: Pick<WorkItemRowProps, 'item'>) {
	if (item.type === 'linked' || item.type === 'work-item') {
		return (
			<span title={item.type === 'linked' ? 'Linked (PR + Work Item)' : 'Work Item'}>
				<ClipboardList className="h-4 w-4" />
			</span>
		);
	}

	return (
		<span title="Pull Request">
			<GitPullRequest className="h-4 w-4" />
		</span>
	);
}

function ExternalItemLink({
	href,
	children,
	className,
}: {
	href: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			onClick={(e) => e.stopPropagation()}
			className={className}
		>
			{children}
			<ExternalLink className="h-3 w-3 shrink-0" />
		</a>
	);
}

function PrimaryItemTitle({ item }: Pick<WorkItemRowProps, 'item'>) {
	if (item.type === 'work-item') {
		if (item.workItemUrl && item.workItemTitle) {
			return (
				<ExternalItemLink
					href={item.workItemUrl}
					className="inline-flex items-center gap-1 text-primary hover:underline"
				>
					{item.workItemTitle}
				</ExternalItemLink>
			);
		}

		return item.workItemTitle ? (
			<span>{item.workItemTitle}</span>
		) : (
			<span className="text-muted-foreground italic">No title</span>
		);
	}

	if (item.prUrl) {
		return (
			<ExternalItemLink
				href={item.prUrl}
				className="inline-flex items-center gap-1 text-primary hover:underline"
			>
				#{item.prNumber}
				{item.prTitle && <span className="ml-1 text-foreground">{item.prTitle}</span>}
			</ExternalItemLink>
		);
	}

	return (
		<span className="text-muted-foreground">
			#{item.prNumber}
			{item.prTitle && <span className="ml-1 text-foreground">{item.prTitle}</span>}
		</span>
	);
}

function SecondaryItemTitle({ item }: Pick<WorkItemRowProps, 'item'>) {
	if (item.type === 'work-item') {
		return <span className="text-xs text-muted-foreground italic">No PR yet</span>;
	}

	if (item.type !== 'linked' || !item.workItemTitle) {
		return null;
	}

	return (
		<span className="flex items-center gap-1 text-xs text-muted-foreground">
			<ClipboardList className="h-3 w-3 shrink-0" />
			{item.workItemUrl ? (
				<ExternalItemLink
					href={item.workItemUrl}
					className="inline-flex items-center gap-1 hover:text-primary hover:underline"
				>
					{item.workItemTitle}
				</ExternalItemLink>
			) : (
				<span>{item.workItemTitle}</span>
			)}
		</span>
	);
}

function WorkItemRow({ item, projectId, projectAvgDurationMs }: WorkItemRowProps) {
	const navigate = useNavigate();
	const canNavigate = item.runCount > 0;

	const handleClick = () => {
		if (!canNavigate) return;

		if ((item.type === 'work-item' || item.type === 'linked') && item.workItemId) {
			navigate({
				to: '/work-items/$projectId/$workItemId',
				params: { projectId, workItemId: item.workItemId },
			});
		} else if (item.type === 'pr' && item.prNumber != null) {
			navigate({
				to: '/prs/$projectId/$prNumber',
				params: { projectId, prNumber: String(item.prNumber) },
			});
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (canNavigate && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			handleClick();
		}
	};

	return (
		<TableRow
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			style={canNavigate ? { cursor: 'pointer' } : undefined}
		>
			{/* Type icon */}
			<TableCell className="px-4 py-3 text-muted-foreground">
				<ItemIcon item={item} />
			</TableCell>

			{/* PR title / number + Associated work item (stacked) */}
			<TableCell className="px-4 py-3 whitespace-normal">
				<div className="flex flex-col gap-1">
					<PrimaryItemTitle item={item} />
					<SecondaryItemTitle item={item} />
				</div>
			</TableCell>

			{/* Duration bar */}
			<TableCell className="hidden px-4 py-3 sm:table-cell" style={{ minWidth: 160 }}>
				<WorkItemDurationBar
					runs={item.runs ?? []}
					projectAvgDurationMs={projectAvgDurationMs ?? null}
				/>
			</TableCell>

			{/* Run count */}
			<TableCell className="px-4 py-3 text-right tabular-nums">
				{canNavigate ? (
					<span className="cursor-pointer text-primary hover:underline">{item.runCount}</span>
				) : (
					item.runCount
				)}
			</TableCell>

			{/* Cost */}
			<TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
				{formatCostSummary(item.totalCostUsd)}
			</TableCell>
		</TableRow>
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
	projectAvgDurationMs,
}: ProjectWorkTableProps) {
	const getAgentColor = useChartColors();
	const total = items.length;
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;
	const pageItems = items.slice(offset, offset + limit);

	// Collect unique agent types from visible items for the legend
	const agentTypesInView = Array.from(
		new Set(pageItems.flatMap((item) => (item.runs ?? []).map((r) => r.agentType))),
	);

	return (
		<div className="space-y-4">
			{/* Agent color legend */}
			{agentTypesInView.length > 0 && (
				<div className="hidden sm:flex flex-wrap gap-3" style={{ fontSize: 12 }}>
					{agentTypesInView.map((at) => (
						<div key={at} className="flex items-center gap-1 text-muted-foreground">
							<span
								style={{
									display: 'inline-block',
									width: 10,
									height: 10,
									borderRadius: 2,
									background: getAgentColor(at),
									flexShrink: 0,
								}}
							/>
							<span>{agentTypeLabel(at)}</span>
						</div>
					))}
				</div>
			)}

			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead className="w-8 px-4 py-3" />
							<TableHead className="px-4 py-3">Title / Associated Item</TableHead>
							<TableHead className="hidden px-4 py-3 sm:table-cell">Duration</TableHead>
							<TableHead className="px-4 py-3 text-right">Runs</TableHead>
							<TableHead className="px-4 py-3 text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{pageItems.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={5}
									className="px-4 py-8 text-center whitespace-normal text-muted-foreground"
								>
									No work found for this project
								</TableCell>
							</TableRow>
						)}
						{pageItems.map((item) => (
							<WorkItemRow
								key={item.id}
								item={item}
								projectId={projectId}
								projectAvgDurationMs={projectAvgDurationMs}
							/>
						))}
					</TableBody>
				</Table>
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
