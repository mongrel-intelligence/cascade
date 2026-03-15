export type ProjectSection =
	| 'general'
	| 'harness'
	| 'work'
	| 'stats'
	| 'integrations'
	| 'agent-configs'
	| 'lifecycle';

export type ProjectSectionRoute =
	| '/projects/$projectId/general'
	| '/projects/$projectId/harness'
	| '/projects/$projectId/work'
	| '/projects/$projectId/stats'
	| '/projects/$projectId/integrations'
	| '/projects/$projectId/agent-configs'
	| '/projects/$projectId/lifecycle';

export const PROJECT_SECTIONS: {
	id: ProjectSection;
	label: string;
	path: string;
	route: ProjectSectionRoute;
}[] = [
	{ id: 'general', label: 'General', path: 'general', route: '/projects/$projectId/general' },
	{ id: 'harness', label: 'Engine', path: 'harness', route: '/projects/$projectId/harness' },
	{ id: 'work', label: 'Work', path: 'work', route: '/projects/$projectId/work' },
	{ id: 'stats', label: 'Stats', path: 'stats', route: '/projects/$projectId/stats' },
	{
		id: 'integrations',
		label: 'Integrations',
		path: 'integrations',
		route: '/projects/$projectId/integrations',
	},
	{
		id: 'agent-configs',
		label: 'Agents',
		path: 'agent-configs',
		route: '/projects/$projectId/agent-configs',
	},
	{
		id: 'lifecycle',
		label: 'Lifecycle',
		path: 'lifecycle',
		route: '/projects/$projectId/lifecycle',
	},
];

export const DEFAULT_PROJECT_SECTION: ProjectSection = 'general';

/**
 * Returns true if the given pathname is within the given project.
 */
export function isProjectActive(pathname: string, projectId: string): boolean {
	return pathname.startsWith(`/projects/${projectId}/`) || pathname === `/projects/${projectId}`;
}

/**
 * Returns true if the given pathname matches a specific section of a project.
 */
export function isSectionActive(pathname: string, projectId: string, sectionPath: string): boolean {
	const fullPath = `/projects/${projectId}/${sectionPath}`;
	return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
}

/**
 * Resolves the default section URL for a given project.
 */
export function resolveDefaultProjectPath(projectId: string): string {
	return `/projects/${projectId}/${DEFAULT_PROJECT_SECTION}`;
}
