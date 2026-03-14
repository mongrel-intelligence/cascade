export type ProjectSection = 'general' | 'harness' | 'work' | 'integrations' | 'agent-configs';

export const PROJECT_SECTIONS: { id: ProjectSection; label: string; path: string }[] = [
	{ id: 'general', label: 'General', path: 'general' },
	{ id: 'harness', label: 'Harness', path: 'harness' },
	{ id: 'work', label: 'Work', path: 'work' },
	{ id: 'integrations', label: 'Integrations', path: 'integrations' },
	{ id: 'agent-configs', label: 'Agent Configs', path: 'agent-configs' },
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
