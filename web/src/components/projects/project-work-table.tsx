import { formatCost } from '@/lib/utils.js';
import { useNavigate } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { ClipboardList, ExternalLink, GitPullRequest } from 'lucide-react';

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
// WorkItemRow sub-component (extracted to reduce complexity)
// ============================================================================

interface WorkItemRowProps {
	item: WorkItem;
	projectId: string;
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

function WorkItemRow({ item, projectId }: WorkItemRowProps) {
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
		<tr
			className="border-b border-border transition-colors hover:bg-muted/30"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			style={canNavigate ? { cursor: 'pointer' } : undefined}
		>
			{/* Type icon */}
			<td className="px-4 py-3 text-muted-foreground">
				<ItemIcon item={item} />
			</td>

			{/* PR title / number + Associated work item (stacked) */}
			<td className="px-4 py-3">
				<div className="flex flex-col gap-1">
					<PrimaryItemTitle item={item} />
					<SecondaryItemTitle item={item} />
				</div>
			</td>

			{/* Run count */}
			<td className="px-4 py-3 text-right tabular-nums">
				{canNavigate ? (
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
							<WorkItemRow key={item.id} item={item} projectId={projectId} />
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
