import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { Separator } from '@/components/ui/separator.js';
import { useOrgContext } from '@/lib/org-context.js';
import { cn } from '@/lib/utils.js';
import { Link, useRouterState } from '@tanstack/react-router';
import {
	Activity,
	Bot,
	Building2,
	FileText,
	FolderGit2,
	KeyRound,
	LayoutDashboard,
	Settings,
	Zap,
} from 'lucide-react';

interface SidebarProps {
	user: { name: string; email: string; role: string } | undefined;
}

const mainNav = [
	{ to: '/' as const, label: 'Runs', icon: Activity },
	{ to: '/projects' as const, label: 'Projects', icon: FolderGit2 },
	{ to: '/webhooklogs' as const, label: 'Webhook Logs', icon: Zap },
];

const settingsNav = [
	{ to: '/settings/general' as const, label: 'General', icon: Settings },
	{ to: '/settings/credentials' as const, label: 'Credentials', icon: KeyRound },
	{ to: '/settings/agents' as const, label: 'Agent Configs', icon: Bot },
	{ to: '/settings/prompts' as const, label: 'Prompts', icon: FileText },
];

function NavLink({
	to,
	label,
	icon: Icon,
	currentPath,
}: {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	currentPath: string;
}) {
	const isActive = currentPath === to || (to !== '/' && currentPath.startsWith(to));
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
			{label}
		</Link>
	);
}

function OrgSwitcher() {
	const { effectiveOrgId, availableOrgs, isAdmin, switchOrg } = useOrgContext();

	if (!isAdmin || !availableOrgs || availableOrgs.length <= 1) return null;

	return (
		<div className="px-2 pb-2">
			<div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				<Building2 className="h-3 w-3" />
				Organization
			</div>
			<Select value={effectiveOrgId ?? undefined} onValueChange={switchOrg}>
				<SelectTrigger className="h-8 text-xs">
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
		</div>
	);
}

export function Sidebar({ user }: SidebarProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	return (
		<div className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
			<div className="flex h-14 items-center border-b border-sidebar-border px-4">
				<LayoutDashboard className="mr-2 h-5 w-5" />
				<span className="font-semibold">CASCADE</span>
			</div>

			<OrgSwitcher />

			<nav className="flex-1 space-y-1 p-2">
				{mainNav.map((item) => (
					<NavLink key={item.to} {...item} currentPath={currentPath} />
				))}

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
