import { ClipboardList, ExternalLink, GitPullRequest } from 'lucide-react';

interface WorkItem {
	id: string;
	type: 'pr' | 'linked';
	prNumber: number;
	repoFullName: string;
	prUrl: string | null;
	prTitle: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	runCount: number;
	updatedAt: Date | string | null;
}

interface ProjectWorkTableProps {
	items: WorkItem[];
	offset: number;
	limit: number;
	onPageChange: (offset: number) => void;
}

export function ProjectWorkTable({ items, offset, limit, onPageChange }: ProjectWorkTableProps) {
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
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Repository</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								Associated Item
							</th>
							<th className="px-4 py-3 text-right font-medium text-muted-foreground">Runs</th>
						</tr>
					</thead>
					<tbody>
						{pageItems.length === 0 && (
							<tr>
								<td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
									No work found for this project
								</td>
							</tr>
						)}
						{pageItems.map((item) => (
							<tr
								key={item.id}
								className="border-b border-border transition-colors hover:bg-muted/30"
							>
								{/* Type icon */}
								<td className="px-4 py-3 text-muted-foreground">
									{item.type === 'linked' ? (
										<span title="Linked (PR + Work Item)">
											<ClipboardList className="h-4 w-4" />
										</span>
									) : (
										<span title="Pull Request">
											<GitPullRequest className="h-4 w-4" />
										</span>
									)}
								</td>

								{/* PR title / number */}
								<td className="px-4 py-3">
									{item.prUrl ? (
										<a
											href={item.prUrl}
											target="_blank"
											rel="noopener noreferrer"
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
								</td>

								{/* Repository */}
								<td className="px-4 py-3 text-muted-foreground">{item.repoFullName}</td>

								{/* Associated work item */}
								<td className="px-4 py-3">
									{item.workItemUrl && item.workItemTitle ? (
										<a
											href={item.workItemUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 text-primary hover:underline"
										>
											{item.workItemTitle}
											<ExternalLink className="h-3 w-3 shrink-0" />
										</a>
									) : item.workItemTitle ? (
										<span>{item.workItemTitle}</span>
									) : (
										<span className="text-muted-foreground italic">None</span>
									)}
								</td>

								{/* Run count */}
								<td className="px-4 py-3 text-right tabular-nums">{item.runCount}</td>
							</tr>
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
