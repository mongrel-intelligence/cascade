import { Header } from '@/components/layout/header.js';
import { Sidebar } from '@/components/layout/sidebar.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Outlet, createRootRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

function RootLayout() {
	const navigate = useNavigate();
	const meQuery = useQuery(trpc.auth.me.queryOptions());

	const isLoginPage = window.location.pathname === '/login';

	useEffect(() => {
		if (meQuery.isError && !isLoginPage) {
			navigate({ to: '/login' });
		}
	}, [meQuery.isError, isLoginPage, navigate]);

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

	if (meQuery.isError) {
		return null;
	}

	return (
		<div className="flex h-screen">
			<Sidebar user={meQuery.data} />
			<div className="flex flex-1 flex-col overflow-hidden">
				<Header user={meQuery.data} />
				<main className="flex-1 overflow-auto p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}

export const rootRoute = createRootRoute({
	component: RootLayout,
});
