import { Header } from '@/components/layout/header.js';
import { Sidebar } from '@/components/layout/sidebar.js';
import { OrgProvider } from '@/lib/org-context.js';
import { queryClient } from '@/lib/query-client.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Outlet, createRootRoute, redirect, useRouterState } from '@tanstack/react-router';

function RootLayout() {
	const routerState = useRouterState();
	const isLoginPage = routerState.location.pathname === '/login';
	const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });

	if (isLoginPage) {
		return <Outlet />;
	}

	if (meQuery.isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-muted-foreground">Loading...</div>
			</div>
		);
	}

	return (
		<OrgProvider me={meQuery.data}>
			<div className="flex h-screen">
				<Sidebar user={meQuery.data} />
				<div className="flex flex-1 flex-col overflow-hidden">
					<Header user={meQuery.data} />
					<main className="flex-1 overflow-auto p-6">
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
		if (location.pathname === '/login') return;
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
