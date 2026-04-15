import { createRoute } from '@tanstack/react-router';
import { ProjectLifecycleAutomations } from '@/components/projects/project-lifecycle-automations.js';
import { projectDetailRoute } from './$projectId.js';

function ProjectLifecyclePage() {
	const { projectId } = projectLifecycleRoute.useParams();
	return <ProjectLifecycleAutomations projectId={projectId} />;
}

export const projectLifecycleRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/lifecycle',
	component: ProjectLifecyclePage,
});
