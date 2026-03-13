import { AgentConfigFormDialog } from '@/components/settings/agent-config-form-dialog.js';
import { AgentConfigsTable } from '@/components/settings/agent-configs-table.js';
import { Button } from '@/components/ui/button.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function GlobalAgentConfigsPage() {
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const configsQuery = useQuery(trpc.agentConfigs.listGlobal.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-bold tracking-tight">Global Agent Configs</h1>
					<p className="text-muted-foreground">
						These settings serve as the platform-wide fallback for all projects.
					</p>
				</div>
				<Button onClick={() => setIsCreateDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Add Global Config
				</Button>
			</div>

			{configsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading configs...</div>
			)}

			{configsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load configs: {configsQuery.error.message}
				</div>
			)}

			{configsQuery.data && <AgentConfigsTable configs={configsQuery.data} isGlobalScope={true} />}

			<AgentConfigFormDialog
				open={isCreateDialogOpen}
				onOpenChange={setIsCreateDialogOpen}
				isGlobalScope={true}
				// Pass null orgId and projectId for global scope
				config={{
					id: 0,
					orgId: null,
					projectId: null,
					agentType: '',
					model: null,
					maxIterations: null,
					agentEngine: null,
					maxConcurrency: null,
				}}
			/>
		</div>
	);
}

export const globalAgentConfigsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/agent-configs',
	component: GlobalAgentConfigsPage,
});
