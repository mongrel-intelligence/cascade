import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { trpc } from '@/lib/trpc.js';
import { AlertingTab } from './integration-alerting-tab.js';
import { SCMTab } from './integration-scm-tab.js';
import { PMWizard } from './pm-wizard.js';

type IntegrationCategory = 'pm' | 'scm' | 'alerting';

// ============================================================================
// Helpers
// ============================================================================

function findIntegrationByCategory(
	integrations: unknown[],
	category: string,
): Record<string, unknown> | undefined {
	return integrations.find((i) => (i as Record<string, unknown>).category === category) as
		| Record<string, unknown>
		| undefined;
}

function TabButton({
	label,
	tab,
	activeTab,
	onClick,
}: {
	label: string;
	tab: IntegrationCategory;
	activeTab: IntegrationCategory;
	onClick: () => void;
}) {
	const isActive = activeTab === tab;
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 min-w-fit whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
				isActive
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			}`}
		>
			{label}
		</button>
	);
}

// ============================================================================
// Main Integration Form
// ============================================================================

export function IntegrationForm({ projectId }: { projectId: string }) {
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));
	const projectQuery = useQuery(trpc.projects.getById.queryOptions({ id: projectId }));
	const [activeTab, setActiveTab] = useState<IntegrationCategory>('pm');

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading integrations...</div>;
	}

	const integrations = integrationsQuery.data ?? [];
	const pmIntegration = findIntegrationByCategory(integrations, 'pm');
	const pmProvider = (pmIntegration?.provider as string) ?? 'trello';
	const alertingIntegration = findIntegrationByCategory(integrations, 'alerting');

	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
				<TabButton
					label="Project Management"
					tab="pm"
					activeTab={activeTab}
					onClick={() => setActiveTab('pm')}
				/>
				<TabButton
					label="Source Control"
					tab="scm"
					activeTab={activeTab}
					onClick={() => setActiveTab('scm')}
				/>
				<TabButton
					label="Alerting"
					tab="alerting"
					activeTab={activeTab}
					onClick={() => setActiveTab('alerting')}
				/>
			</div>

			{activeTab === 'pm' && (
				<PMWizard
					projectId={projectId}
					initialProvider={pmProvider}
					initialConfig={pmIntegration?.config as Record<string, unknown>}
				/>
			)}

			{activeTab === 'scm' && <SCMTab projectId={projectId} project={projectQuery.data} />}

			{activeTab === 'alerting' && (
				<AlertingTab projectId={projectId} alertingIntegration={alertingIntegration} />
			)}
		</div>
	);
}
