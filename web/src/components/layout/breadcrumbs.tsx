import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { PROJECT_SECTIONS } from '@/lib/project-sections.js';
import { trpc } from '@/lib/trpc.js';

interface Segment {
	label: string;
	href?: string;
}

function buildProjectSegments(
	projectId: string,
	sectionSlug: string | undefined,
	projectName: string,
): Segment[] {
	const section = PROJECT_SECTIONS.find((s) => s.id === sectionSlug);
	const base: Segment[] = [
		{ label: 'Projects', href: '/projects' },
		section
			? { label: projectName, href: `/projects/${projectId}/general` }
			: { label: projectName },
	];
	if (section) {
		base.push({ label: section.label });
	}
	return base;
}

function buildSettingsSegments(pathname: string): Segment[] {
	const match = pathname.match(/^\/settings\/([^/]+)/);
	if (match) {
		const sub = match[1];
		const subLabel = sub.charAt(0).toUpperCase() + sub.slice(1);
		return [{ label: 'Settings', href: '/settings/general' }, { label: subLabel }];
	}
	return [{ label: 'Settings' }];
}

function buildGlobalSegments(sub: string): Segment[] {
	const subLabel = sub.charAt(0).toUpperCase() + sub.slice(1).replace(/-/g, ' ');
	return [{ label: 'Global', href: '/global/runs' }, { label: subLabel }];
}

/**
 * Parse the current pathname into breadcrumb segments.
 *
 * Routes handled:
 *  /projects                          → Projects
 *  /projects/:id                      → Projects > <name>
 *  /projects/:id/:section             → Projects > <name> > <section label>
 *  /runs/:id                          → Runs > <agent type>
 *  /prs/:projectId/:prNumber          → Projects > <name> > Work > PR #<n>
 *  /work-items/:projectId/:workItemId → Projects > <name> > Work > Work Item Runs
 *  /settings/*                        → Settings > <sub>
 *  /global/*                          → Global > <sub>
 */
function useSegments(): Segment[] {
	const routerState = useRouterState();
	const pathname = routerState.location.pathname;

	const projectsMatch = pathname.match(/^\/projects\/([^/]+)(\/([^/]+))?/);
	const runsMatch = pathname.match(/^\/runs\/([^/]+)/);
	const prsMatch = pathname.match(/^\/prs\/([^/]+)\/([^/]+)/);
	const workItemsMatch = pathname.match(/^\/work-items\/([^/]+)\/([^/]+)/);
	const globalMatch = pathname.match(/^\/global\/([^/]+)/);

	const resolvedProjectId = projectsMatch?.[1] ?? prsMatch?.[1] ?? workItemsMatch?.[1] ?? undefined;

	const projectQuery = useQuery({
		...trpc.projects.getById.queryOptions({ id: resolvedProjectId ?? '' }),
		enabled: !!resolvedProjectId,
	});

	const runId = runsMatch?.[1];
	const runQuery = useQuery({
		...trpc.runs.getById.queryOptions({ id: runId ?? '' }),
		enabled: !!runId,
	});

	const projectName = projectQuery.data?.name ?? resolvedProjectId ?? '…';

	if (pathname === '/projects') return [{ label: 'Projects' }];

	if (projectsMatch?.[1]) {
		return buildProjectSegments(projectsMatch[1], projectsMatch[3], projectName);
	}

	if (runsMatch?.[1]) {
		return [{ label: 'Runs', href: '/' }, { label: runQuery.data?.agentType ?? '…' }];
	}

	if (prsMatch?.[1] && prsMatch?.[2]) {
		return [
			{ label: 'Projects', href: '/projects' },
			{ label: projectName, href: `/projects/${prsMatch[1]}/general` },
			{ label: 'Work', href: `/projects/${prsMatch[1]}/work` },
			{ label: `PR #${prsMatch[2]}` },
		];
	}

	if (workItemsMatch?.[1]) {
		return [
			{ label: 'Projects', href: '/projects' },
			{ label: projectName, href: `/projects/${workItemsMatch[1]}/general` },
			{ label: 'Work', href: `/projects/${workItemsMatch[1]}/work` },
			{ label: 'Work Item Runs' },
		];
	}

	if (pathname.startsWith('/settings')) return buildSettingsSegments(pathname);

	if (globalMatch?.[1]) return buildGlobalSegments(globalMatch[1]);

	if (pathname === '/') return [{ label: 'Runs' }];

	return [];
}

export function Breadcrumbs() {
	const segments = useSegments();

	if (segments.length === 0) return null;

	return (
		<nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden">
			{segments.map((segment, i) => {
				const isLast = i === segments.length - 1;
				return (
					<span key={segment.label} className="flex min-w-0 items-center gap-1">
						{i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
						{isLast || !segment.href ? (
							<span
								className={
									isLast
										? 'truncate text-sm font-medium text-foreground'
										: 'truncate text-sm text-muted-foreground'
								}
							>
								{segment.label}
							</span>
						) : (
							<Link
								to={segment.href}
								className="truncate text-sm text-muted-foreground hover:text-foreground"
							>
								{segment.label}
							</Link>
						)}
					</span>
				);
			})}
		</nav>
	);
}
