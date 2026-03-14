import { IntegrationForm } from '@/components/projects/integration-form.js';
import { ProjectAgentConfigs } from '@/components/projects/project-agent-configs.js';
import { ProjectGeneralForm } from '@/components/projects/project-general-form.js';
import { ProjectWorkTable } from '@/components/projects/project-work-table.js';
import { ProjectWorkDurationChart } from '@/components/runs/project-work-duration-chart.js';
import { WorkItemCostChart } from '@/components/runs/work-item-cost-chart.js';
import { trpc } from '@/lib/trpc.js';
import { cn, formatCost } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

type Tab = 'general' | 'work' | 'integrations' | 'agent-configs';

const WORK_PAGE_SIZE = 50;

function ProjectDetailPage() {
	const { projectId } = projectDetailRoute.useParams();
	const [activeTab, setActiveTab] = useState<Tab>('general');
	const [workOffset, setWorkOffset] = useState(0);

	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));
	const workQuery = useQuery({
		...trpc.prs.listUnified.queryOptions({ projectId }),
		enabled: activeTab === 'work',
	});
	const workStatsQuery = useQuery({
		...trpc.prs.workStats.queryOptions({ projectId }),
		enabled: activeTab === 'work',
	});

	if (projectQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading project...</div>;
	}

	if (projectQuery.isError || !projectQuery.data) {
		return <div className="py-8 text-center text-destructive">Project not found</div>;
	}

	const project = projectQuery.data;

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'work', label: 'Work' },
		{ id: 'integrations', label: 'Integrations' },
		{ id: 'agent-configs', label: 'Agent Configs' },
	];

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2">
				<Link
					to="/projects"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Projects
				</Link>
				<span className="text-muted-foreground">/</span>
				<h1 className="text-xl font-bold">{project.name}</h1>
			</div>

			<div className="border-b border-border overflow-x-auto">
				<nav className="flex gap-4">
					{tabs.map((tab) => (
						<button
							type="button"
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								'border-b-2 px-1 pb-3 text-sm font-medium transition-colors whitespace-nowrap',
								activeTab === tab.id
									? 'border-primary text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground',
							)}
						>
							{tab.label}
						</button>
					))}
				</nav>
			</div>

			{activeTab === 'general' && <ProjectGeneralForm project={project} />}

			{activeTab === 'work' && (
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold">Work</h2>
						{workQuery.data && (
							<span className="text-sm text-muted-foreground">{workQuery.data.length} total</span>
						)}
					</div>

					{workStatsQuery.data && workStatsQuery.data.length > 0 && (
						<>
							<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
								<WorkItemCostChart
									runs={workStatsQuery.data.map((r, i) => ({ ...r, id: String(i) }))}
								/>
								<ProjectWorkDurationChart runs={workStatsQuery.data} />
							</div>
							<div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
								<span>
									<span className="font-medium text-foreground">
										{workStatsQuery.data.length >= 500 ? '500+' : workStatsQuery.data.length}
									</span>{' '}
									{workStatsQuery.data.length >= 500
										? 'latest runs (showing most recent 500)'
										: 'total runs'}
								</span>
								<span>
									<span className="font-medium text-foreground">
										{formatCost(
											workStatsQuery.data
												.reduce(
													(sum, r) => sum + (r.costUsd != null ? Number.parseFloat(r.costUsd) : 0),
													0,
												)
												.toFixed(4),
										)}
									</span>{' '}
									total cost
								</span>
							</div>
						</>
					)}

					{workQuery.isLoading && (
						<div className="py-8 text-center text-muted-foreground">Loading work items...</div>
					)}

					{workQuery.isError && (
						<div className="py-8 text-center text-destructive">
							Failed to load work: {workQuery.error.message}
						</div>
					)}

					{workQuery.data && (
						<ProjectWorkTable
							items={workQuery.data}
							projectId={projectId}
							offset={workOffset}
							limit={WORK_PAGE_SIZE}
							onPageChange={setWorkOffset}
						/>
					)}
				</div>
			)}

			{activeTab === 'integrations' && <IntegrationForm projectId={projectId} />}
			{activeTab === 'agent-configs' && <ProjectAgentConfigs projectId={projectId} />}
		</div>
	);
}

export const projectDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId',
	component: ProjectDetailPage,
});
