import { IntegrationForm } from '@/components/projects/integration-form.js';
import { createRoute } from '@tanstack/react-router';
import { projectDetailRoute } from './$projectId.js';

function ProjectIntegrationsPage() {
	const { projectId } = projectIntegrationsRoute.useParams();
	return <IntegrationForm projectId={projectId} />;
}

export const projectIntegrationsRoute = createRoute({
	getParentRoute: () => projectDetailRoute,
	path: '/integrations',
	component: ProjectIntegrationsPage,
});
