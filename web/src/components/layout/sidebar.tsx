import { cn } from '@/lib/utils.js';
import { Link, useRouterState } from '@tanstack/react-router';
import { Activity, LayoutDashboard } from 'lucide-react';

interface SidebarProps {
	user: { name: string; email: string } | undefined;
}

const navItems = [{ to: '/' as const, label: 'Runs', icon: Activity }];

export function Sidebar({ user }: SidebarProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	return (
		<div className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
			<div className="flex h-14 items-center border-b border-sidebar-border px-4">
				<LayoutDashboard className="mr-2 h-5 w-5" />
				<span className="font-semibold">CASCADE</span>
			</div>

			<nav className="flex-1 space-y-1 p-2">
				{navItems.map((item) => (
					<Link
						key={item.to}
						to={item.to}
						className={cn(
							'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
							currentPath === item.to
								? 'bg-sidebar-accent text-sidebar-accent-foreground'
								: 'text-sidebar-foreground hover:bg-sidebar-accent/50',
						)}
					>
						<item.icon className="h-4 w-4" />
						{item.label}
					</Link>
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
