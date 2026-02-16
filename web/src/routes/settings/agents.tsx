import { AgentConfigFormDialog } from '@/components/settings/agent-config-form-dialog.js';
import { AgentConfigsTable } from '@/components/settings/agent-configs-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function AgentConfigsPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Configs</h1>
					<p className="text-sm text-muted-foreground">
						Global and organization-scoped agent configuration overrides.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					New Agent Config
				</button>
			</div>

			{configsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading agent configs...</div>
			)}

			{configsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load agent configs: {configsQuery.error.message}
				</div>
			)}

			{configsQuery.data && <AgentConfigsTable configs={configsQuery.data} />}

			<AgentConfigFormDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}

export const settingsAgentsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/agents',
	component: AgentConfigsPage,
});
