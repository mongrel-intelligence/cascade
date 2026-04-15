import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from '../__root.js';

function ProjectShellPage() {
	return <Outlet />;
}

export const projectDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId',
	component: ProjectShellPage,
	beforeLoad: ({ location, params }) => {
		// If navigating exactly to /projects/$projectId, redirect to /general subsection
		const path = location.pathname;
		if (path.match(/^\/projects\/[^/]+\/?$/)) {
			throw redirect({
				to: '/projects/$projectId/general',
				params: { projectId: params.projectId },
			});
		}
	},
});
