import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ProjectGeneralForm } from '@/components/projects/project-general-form.js';
import { trpc } from '@/lib/trpc.js';
import { projectDetailRoute } from './$projectId.js';

function ProjectGeneralPage() {
	const { projectId } = projectGeneralRoute.useParams();
	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));

	if (projectQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
	}

	if (projectQuery.isError || !projectQuery.data) {
		return <div className="py-8 text-center text-destructive">Project not found</div>;
	}

	return <ProjectGeneralForm project={projectQuery.data} />;
}

export const projectGeneralRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/general',
	component: ProjectGeneralPage,
});
