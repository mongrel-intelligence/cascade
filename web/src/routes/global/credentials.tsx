import { CredentialsTable } from '@/components/settings/credentials-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root.js';

function GlobalCredentialsPage() {
	const credentialsQuery = useQuery(trpc.credentials.listAll.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Global Credentials</h1>
				{credentialsQuery.data && (
					<span className="text-sm text-muted-foreground">
						{credentialsQuery.data.length} credentials
					</span>
				)}
			</div>

			{credentialsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading credentials...</div>
			)}

			{credentialsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load credentials: {credentialsQuery.error.message}
				</div>
			)}

			{credentialsQuery.data && (
				<CredentialsTable credentials={credentialsQuery.data} showOrg={true} />
			)}
		</div>
	);
}

export const globalCredentialsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/credentials',
	component: GlobalCredentialsPage,
});
