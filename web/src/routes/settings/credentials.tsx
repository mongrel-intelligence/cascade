import { CredentialFormDialog } from '@/components/settings/credential-form-dialog.js';
import { CredentialsTable } from '@/components/settings/credentials-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function CredentialsPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Credentials</h1>
					<p className="text-sm text-muted-foreground">
						Organization-scoped credentials (API keys, tokens).
					</p>
				</div>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					New Credential
				</button>
			</div>

			{credentialsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading credentials...</div>
			)}

			{credentialsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load credentials: {credentialsQuery.error.message}
				</div>
			)}

			{credentialsQuery.data && <CredentialsTable credentials={credentialsQuery.data} />}

			<CredentialFormDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}

export const settingsCredentialsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/credentials',
	component: CredentialsPage,
});
