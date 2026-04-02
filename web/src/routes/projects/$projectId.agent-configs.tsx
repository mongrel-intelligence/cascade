import { createRoute } from '@tanstack/react-router';
import { ProjectAgentConfigs } from '@/components/projects/project-agent-configs.js';
import { projectDetailRoute } from './$projectId.js';

function ProjectAgentConfigsPage() {
	const { projectId } = projectAgentConfigsRoute.useParams();
	return <ProjectAgentConfigs projectId={projectId} />;
}

export const projectAgentConfigsRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/agent-configs',
	component: ProjectAgentConfigsPage,
});
