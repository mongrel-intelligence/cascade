import { ProjectFormDialog } from '@/components/projects/project-form-dialog.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { Separator } from '@/components/ui/separator.js';
import { useOrgContext } from '@/lib/org-context.js';
import { PROJECT_SECTIONS, isProjectActive, isSectionActive } from '@/lib/project-sections.js';
import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import {
	Activity,
	BookOpen,
	Building,
	Building2,
	ChevronDown,
	ChevronRight,
	FolderGit2,
	Plus,
	Settings,
	Users,
	Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface SidebarProps {
	user: { name: string; email: string; role: string } | undefined;
}

const mainNav = [{ to: '/' as const, label: 'Runs', icon: Activity }];

const globalNav = [
	{ to: '/global/runs' as const, label: 'Global Runs', icon: Activity },
	{ to: '/global/webhook-logs' as const, label: 'Webhook Logs', icon: Zap },
	{ to: '/global/definitions' as const, label: 'Agent Definitions', icon: BookOpen },
	{ to: '/global/organizations' as const, label: 'Organizations', icon: Building },
];

const settingsNav = [
	{ to: '/settings/general' as const, label: 'General', icon: Settings },
	{ to: '/settings/users' as const, label: 'Users', icon: Users },
];

function NavLink({
	to,
	label,
	icon: Icon,
	currentPath,
	exact,
}: {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	currentPath: string;
	exact?: boolean;
}) {
	const isActive = exact
		? currentPath === to
		: currentPath === to || (to !== '/' && currentPath.startsWith(to));
	return (
		<Link
			to={to}
			className={cn(
				'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
				isActive
					? 'bg-sidebar-accent text-sidebar-accent-foreground'
					: 'text-sidebar-foreground hover:bg-sidebar-accent/50',
			)}
		>
			<Icon className="h-4 w-4" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

interface ProjectNavItemProps {
	project: { id: string; name: string };
	currentPath: string;
}

function ProjectNavItem({ project, currentPath }: ProjectNavItemProps) {
	const activeProject = isProjectActive(currentPath, project.id);
	const [isExpanded, setIsExpanded] = useState(activeProject);

	// Sync expansion state when the active project changes due to URL navigation
	useEffect(() => {
		if (activeProject) {
			setIsExpanded(true);
		}
	}, [activeProject]);

	return (
		<div>
			<button
				type="button"
				onClick={() => setIsExpanded((prev) => !prev)}
				className={cn(
					'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
					activeProject
						? 'bg-sidebar-accent text-sidebar-accent-foreground'
						: 'text-sidebar-foreground hover:bg-sidebar-accent/50',
				)}
			>
				<FolderGit2 className="h-4 w-4 shrink-0" />
				<span className="flex-1 truncate text-left">{project.name}</span>
				{isExpanded ? (
					<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
				)}
			</button>

			{isExpanded && (
				<div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
					{PROJECT_SECTIONS.map((section) => {
						const sectionActive = isSectionActive(currentPath, project.id, section.path);
						return (
							<Link
								key={section.id}
								to={section.route}
								params={{ projectId: project.id }}
								className={cn(
									'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
									sectionActive
										? 'bg-sidebar-accent text-sidebar-accent-foreground'
										: 'text-sidebar-foreground hover:bg-sidebar-accent/50',
								)}
							>
								{section.label}
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}

function OrgBranding({ user }: { user: SidebarProps['user'] }) {
	const { effectiveOrgId, availableOrgs, orgName, switchOrg } = useOrgContext();
	const isSuperadmin = user?.role === 'superadmin';

	if (isSuperadmin && availableOrgs && availableOrgs.length > 1 && effectiveOrgId) {
		return (
			<Select value={effectiveOrgId} onValueChange={switchOrg}>
				<SelectTrigger className="h-14 w-full rounded-none border-0 border-b border-sidebar-border px-4 text-sm font-semibold focus:ring-0 gap-2">
					<Building2 className="h-4 w-4 shrink-0" />
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{availableOrgs.map((org) => (
						<SelectItem key={org.id} value={org.id} className="text-xs">
							{org.name ?? org.id}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	return (
		<div className="flex h-14 items-center border-b border-sidebar-border px-4">
			<Building2 className="mr-2 h-5 w-5 shrink-0" />
			<span className="font-semibold truncate">{orgName ?? 'Loading...'}</span>
		</div>
	);
}

export function Sidebar({ user }: SidebarProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const { data: projects } = useQuery(trpc.projects.list.queryOptions());
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	return (
		<div className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
			<OrgBranding user={user} />

			<nav className="flex-1 space-y-1 p-2 overflow-y-auto">
				{mainNav.map((item) => (
					<NavLink key={item.to} {...item} currentPath={currentPath} />
				))}

				<Separator className="my-3" />

				<div className="flex items-center justify-between px-3 py-1">
					<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Projects
					</span>
					<button
						type="button"
						onClick={() => setCreateDialogOpen(true)}
						className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
						title="New Project"
					>
						<Plus className="h-3.5 w-3.5" />
					</button>
				</div>
				<div className="flex flex-col gap-0.5">
					{projects && projects.length > 0 ? (
						projects.map((project) => (
							<ProjectNavItem key={project.id} project={project} currentPath={currentPath} />
						))
					) : (
						<button
							type="button"
							onClick={() => setCreateDialogOpen(true)}
							className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground text-left"
						>
							+ Create a project
						</button>
					)}
				</div>

				<ProjectFormDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

				<Separator className="my-3" />

				<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Settings
				</div>
				{settingsNav.map((item) => (
					<NavLink key={item.to} {...item} currentPath={currentPath} />
				))}

				{user?.role === 'superadmin' && (
					<>
						<Separator className="my-3" />
						<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							Global
						</div>
						{globalNav.map((item) => (
							<NavLink key={item.to} {...item} currentPath={currentPath} />
						))}
					</>
				)}
			</nav>

			{user && (
				<div className="border-t border-sidebar-border p-4">
					<div className="text-sm font-medium truncate">{user.name}</div>
					<div className="text-xs text-muted-foreground truncate">{user.email}</div>
				</div>
			)}
		</div>
	);
}
