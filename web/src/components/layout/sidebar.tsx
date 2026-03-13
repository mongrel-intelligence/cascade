import { Separator } from '@/components/ui/separator.js';
import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import {
	Activity,
	BookOpen,
	Bot,
	Building,
	FolderGit2,
	KeyRound,
	LayoutDashboard,
	Settings,
	SlidersHorizontal,
	Zap,
} from 'lucide-react';

interface SidebarProps {
	user: { name: string; email: string; role: string } | undefined;
}

const mainNav = [{ to: '/' as const, label: 'Runs', icon: Activity }];

const globalNav = [
	{ to: '/global/runs' as const, label: 'Global Runs', icon: Activity },
	{ to: '/global/webhook-logs' as const, label: 'Webhook Logs', icon: Zap },
	{ to: '/global/agent-configs' as const, label: 'Global Agent Configs', icon: Bot },
	{ to: '/global/defaults' as const, label: 'Cascade Defaults', icon: SlidersHorizontal },
	{ to: '/global/definitions' as const, label: 'Agent Definitions', icon: BookOpen },
	{ to: '/global/organizations' as const, label: 'Organizations', icon: Building },
	{ to: '/global/credentials' as const, label: 'Global Credentials', icon: KeyRound },
];

const settingsNav = [
	{ to: '/settings/general' as const, label: 'General', icon: Settings },
	{ to: '/settings/credentials' as const, label: 'Credentials', icon: KeyRound },
	{ to: '/settings/agents' as const, label: 'Agent Configs', icon: Bot },
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

export function Sidebar({ user }: SidebarProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const { data: projects } = useQuery(trpc.projects.list.queryOptions());

	return (
		<div className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
			<div className="flex h-14 items-center border-b border-sidebar-border px-4">
				<LayoutDashboard className="mr-2 h-5 w-5" />
				<span className="font-semibold">CASCADE</span>
			</div>

			<nav className="flex-1 space-y-1 p-2 overflow-y-auto">
				{mainNav.map((item) => (
					<NavLink key={item.to} {...item} currentPath={currentPath} />
				))}

				<Separator className="my-3" />

				<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Projects
				</div>
				<div className="overflow-y-auto max-h-48">
					{projects && projects.length > 0 ? (
						projects.map((project) => (
							<NavLink
								key={project.id}
								to={`/projects/${project.id}`}
								label={project.name}
								icon={FolderGit2}
								currentPath={currentPath}
							/>
						))
					) : (
						<Link
							to="/projects"
							className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
						>
							+ Create a project
						</Link>
					)}
				</div>
				<NavLink
					to="/projects"
					label="All Projects"
					icon={FolderGit2}
					currentPath={currentPath}
					exact
				/>

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

				<Separator className="my-3" />

				<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Settings
				</div>
				{settingsNav.map((item) => (
					<NavLink key={item.to} {...item} currentPath={currentPath} />
				))}
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
