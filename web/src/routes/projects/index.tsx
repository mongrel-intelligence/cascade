import { ProjectFormDialog } from '@/components/projects/project-form-dialog.js';
import { ProjectsTable } from '@/components/projects/projects-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function ProjectsListPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const projectsQuery = useQuery(trpc.projects.listFull.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Projects</h1>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					New Project
				</button>
			</div>

			{projectsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading projects...</div>
			)}

			{projectsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load projects: {projectsQuery.error.message}
				</div>
			)}

			{projectsQuery.data && <ProjectsTable projects={projectsQuery.data} />}

			<ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}

export const projectsIndexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects',
	component: ProjectsListPage,
});
