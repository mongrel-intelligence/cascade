import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc.js';

interface RunFiltersProps {
	projectId: string;
	status: string;
	agentType: string;
	onProjectChange: (v: string) => void;
	onStatusChange: (v: string) => void;
	onAgentTypeChange: (v: string) => void;
	projects?: { id: string; name: string }[];
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
	projects: projectsProp,
}: RunFiltersProps) {
	const defaultProjectsQuery = useQuery({
		...trpc.projects.list.queryOptions(),
		enabled: !projectsProp,
	});

	const projects = projectsProp || defaultProjectsQuery.data || [];

	const selectClass =
		'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto';

	return (
		<div className="flex flex-wrap items-center gap-3">
			<select
				value={projectId}
				onChange={(e) => onProjectChange(e.target.value)}
				className={selectClass}
			>
				<option value="">All projects</option>
				{projects.map((p) => (
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
