import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface RunFiltersProps {
	projectId: string;
	status: string;
	agentType: string;
	onProjectChange: (v: string) => void;
	onStatusChange: (v: string) => void;
	onAgentTypeChange: (v: string) => void;
}

const statuses = ['running', 'completed', 'failed', 'timed_out'];
const agentTypes = [
	'splitting',
	'planning',
	'implementation',
	'review',
	'debug',
	'respond-to-review',
	'respond-to-pr-comment',
];

export function RunFilters({
	projectId,
	status,
	agentType,
	onProjectChange,
	onStatusChange,
	onAgentTypeChange,
}: RunFiltersProps) {
	const projectsQuery = useQuery(trpc.projects.list.queryOptions());

	const selectClass =
		'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

	return (
		<div className="flex flex-wrap items-center gap-3">
			<select
				value={projectId}
				onChange={(e) => onProjectChange(e.target.value)}
				className={selectClass}
			>
				<option value="">All projects</option>
				{projectsQuery.data?.map((p) => (
					<option key={p.id} value={p.id}>
						{p.name}
					</option>
				))}
			</select>

			<select
				value={status}
				onChange={(e) => onStatusChange(e.target.value)}
				className={selectClass}
			>
				<option value="">All statuses</option>
				{statuses.map((s) => (
					<option key={s} value={s}>
						{s === 'timed_out' ? 'timed out' : s}
					</option>
				))}
			</select>

			<select
				value={agentType}
				onChange={(e) => onAgentTypeChange(e.target.value)}
				className={selectClass}
			>
				<option value="">All agent types</option>
				{agentTypes.map((t) => (
					<option key={t} value={t}>
						{t}
					</option>
				))}
			</select>
		</div>
	);
}
