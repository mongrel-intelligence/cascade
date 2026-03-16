import { Header } from '@/components/layout/header.js';
import { MobileSidebar } from '@/components/layout/mobile-sidebar.js';
import { Sidebar } from '@/components/layout/sidebar.js';
import { OrgProvider } from '@/lib/org-context.js';
import { queryClient } from '@/lib/query-client.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Outlet, createRootRoute, redirect, useRouterState } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';

const BARE_PATHS = ['/login', '/oauth/trello/callback'];

function RootLayout() {
	const routerState = useRouterState();
	const isBarePage = BARE_PATHS.includes(routerState.location.pathname);
	const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false, enabled: !isBarePage });
	const [mobileOpen, setMobileOpen] = useState(false);

	if (isBarePage) {
		return <Outlet />;
	}

	if (meQuery.isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-muted-foreground">Loading...</div>
			</div>
		);
	}

	const mobileMenuTrigger = (
		<button
			type="button"
			onClick={() => setMobileOpen(true)}
			className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
			aria-label="Open navigation menu"
		>
			<Menu className="h-5 w-5" />
		</button>
	);

	return (
		<OrgProvider me={meQuery.data}>
			<div className="flex h-screen">
				<div className="hidden md:flex">
					<Sidebar user={meQuery.data} />
				</div>
				<MobileSidebar user={meQuery.data} open={mobileOpen} onOpenChange={setMobileOpen} />
				<div className="flex flex-1 flex-col overflow-hidden">
					<Header user={meQuery.data} mobileMenuTrigger={mobileMenuTrigger} />
					<main className="flex-1 overflow-auto p-4 md:p-6">
						<Outlet />
					</main>
				</div>
			</div>
		</OrgProvider>
	);
}

function PendingComponent() {
	return (
		<div className="flex h-screen items-center justify-center">
			<div className="text-muted-foreground">Loading...</div>
		</div>
	);
}

export const rootRoute = createRootRoute({
	component: RootLayout,
	pendingComponent: PendingComponent,
	beforeLoad: async ({ location }) => {
		if (BARE_PATHS.includes(location.pathname)) return;
		try {
			await queryClient.ensureQueryData({
				...trpc.auth.me.queryOptions(),
				retry: false,
			});
		} catch {
			throw redirect({ to: '/login' });
		}
	},
});
