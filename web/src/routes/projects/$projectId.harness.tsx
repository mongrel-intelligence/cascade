import { ProjectHarnessForm } from '@/components/projects/project-harness-form.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { projectDetailRoute } from './$projectId.js';

function ProjectHarnessPage() {
	const { projectId } = projectHarnessRoute.useParams();
	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));

	if (projectQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
	}

	if (projectQuery.isError || !projectQuery.data) {
		return <div className="py-8 text-center text-destructive">Project not found</div>;
	}

	return <ProjectHarnessForm project={projectQuery.data} />;
}

export const projectHarnessRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/harness',
	component: ProjectHarnessPage,
});
