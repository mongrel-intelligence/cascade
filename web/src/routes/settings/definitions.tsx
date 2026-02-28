import { AgentDefinitionFormDialog } from '@/components/settings/agent-definition-form.js';
import { AgentDefinitionsTable } from '@/components/settings/agent-definition-table.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from '../__root.js';

function AgentDefinitionsPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const definitionsQuery = useQuery(trpc.agentDefinitions.list.queryOptions());

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Definitions</h1>
					<p className="text-sm text-muted-foreground">
						View and edit full agent definitions including capabilities, tools, and strategies.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					New Definition
				</button>
			</div>

			{definitionsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading agent definitions...</div>
			)}

			{definitionsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load agent definitions: {definitionsQuery.error.message}
				</div>
			)}

			{definitionsQuery.data && <AgentDefinitionsTable definitions={definitionsQuery.data} />}

			<AgentDefinitionFormDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}

export const settingsDefinitionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/definitions',
	component: AgentDefinitionsPage,
});
