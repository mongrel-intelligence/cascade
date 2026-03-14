import {
	DEFAULT_PROJECT_SECTION,
	PROJECT_SECTIONS,
	type ProjectSection,
} from '@/lib/project-sections.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, redirect } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { rootRoute } from '../__root.js';

// Re-export for backward compatibility
export type { ProjectSection };
export { DEFAULT_PROJECT_SECTION, PROJECT_SECTIONS };

function ProjectShellPage() {
	const { projectId } = projectDetailRoute.useParams();

	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));

	if (projectQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading project...</div>;
	}

	if (projectQuery.isError || !projectQuery.data) {
		return <div className="py-8 text-center text-destructive">Project not found</div>;
	}

	const project = projectQuery.data;

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

			<Outlet />
		</div>
	);
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
