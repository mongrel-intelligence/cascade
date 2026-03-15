const agentTypes = [
	'splitting',
	'planning',
	'implementation',
	'review',
	'debug',
	'respond-to-review',
	'respond-to-pr-comment',
	'respond-to-ci',
	'respond-to-planning-comment',
	'backlog-manager',
	'resolve-conflicts',
];

const statuses = ['completed', 'failed', 'timed_out'];

const timeRanges = [
	{ value: '7', label: 'Last 7 days' },
	{ value: '30', label: 'Last 30 days' },
	{ value: '90', label: 'Last 90 days' },
	{ value: 'all', label: 'All time' },
];

export interface StatsFilters {
	timeRange: string;
	agentType: string;
	status: string;
}

interface StatsFiltersProps {
	filters: StatsFilters;
	onFilterChange: (filters: StatsFilters) => void;
}

const selectClass =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto';

export function StatsFiltersBar({ filters, onFilterChange }: StatsFiltersProps) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<select
				value={filters.timeRange}
				onChange={(e) => onFilterChange({ ...filters, timeRange: e.target.value })}
				className={selectClass}
			>
				{timeRanges.map((r) => (
					<option key={r.value} value={r.value}>
						{r.label}
					</option>
				))}
			</select>

			<select
				value={filters.agentType}
				onChange={(e) => onFilterChange({ ...filters, agentType: e.target.value })}
				className={selectClass}
			>
				<option value="">All agent types</option>
				{agentTypes.map((t) => (
					<option key={t} value={t}>
						{t}
					</option>
				))}
			</select>

			<select
				value={filters.status}
				onChange={(e) => onFilterChange({ ...filters, status: e.target.value })}
				className={selectClass}
			>
				<option value="">All statuses</option>
				{statuses.map((s) => (
					<option key={s} value={s}>
						{s === 'timed_out' ? 'timed out' : s}
					</option>
				))}
			</select>
		</div>
	);
}
