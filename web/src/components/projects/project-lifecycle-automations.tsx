import { TriggerToggles } from '@/components/shared/trigger-toggles.js';
import { LIFECYCLE_TRIGGERS } from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

export function ProjectLifecycleAutomations({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	// Integrations query (for lifecycle triggers)
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));
	const integrationsQueryKey = trpc.projects.integrations.list.queryOptions({ projectId }).queryKey;

	const [localLifecycleTriggers, setLocalLifecycleTriggers] = useState<Record<string, unknown>>({});
	const [lifecycleSaving, setLifecycleSaving] = useState(false);
	const [lifecycleSaved, setLifecycleSaved] = useState(false);
	const lifecycleSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Lifecycle trigger mutation (uses legacy save mechanism)
	const updateTriggersMutation = useMutation({
		mutationFn: ({
			category,
			triggers,
		}: { category: 'pm' | 'scm'; triggers: Record<string, unknown> }) =>
			trpcClient.projects.integrations.updateTriggers.mutate({
				projectId,
				category,
				triggers: triggers as Record<string, boolean | Record<string, boolean>>,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: integrationsQueryKey });
		},
	});

	// Derive trigger values for lifecycle triggers
	const integrations = (integrationsQuery.data ?? []) as Array<Record<string, unknown>>;
	const scmIntegration = integrations.find((i) => i.category === 'scm');
	const emptyTriggers = useMemo<Record<string, unknown>>(() => ({}), []);
	const scmTriggers = (scmIntegration?.triggers as Record<string, unknown>) ?? emptyTriggers;

	// Sync lifecycle trigger state
	useEffect(() => {
		setLocalLifecycleTriggers(scmTriggers);
	}, [scmTriggers]);

	// Clean up the lifecycle "Saved" timer on unmount
	useEffect(() => {
		return () => {
			if (lifecycleSavedTimerRef.current !== null) {
				clearTimeout(lifecycleSavedTimerRef.current);
			}
		};
	}, []);

	const handleSaveLifecycle = async () => {
		setLifecycleSaving(true);
		try {
			const changed: Record<string, unknown> = {};
			for (const t of LIFECYCLE_TRIGGERS) {
				if (t.key in localLifecycleTriggers) {
					changed[t.key] = localLifecycleTriggers[t.key];
				}
			}
			await updateTriggersMutation.mutateAsync({ category: 'scm', triggers: changed });
			if (lifecycleSavedTimerRef.current !== null) {
				clearTimeout(lifecycleSavedTimerRef.current);
			}
			setLifecycleSaved(true);
			lifecycleSavedTimerRef.current = setTimeout(() => setLifecycleSaved(false), 2000);
		} finally {
			setLifecycleSaving(false);
		}
	};

	if (integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading lifecycle automations...</div>;
	}

	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold">Lifecycle Automations</h2>
				<p className="text-sm text-muted-foreground mt-1">
					These automations update card status but do not run an agent.
				</p>
			</div>

			{LIFECYCLE_TRIGGERS.length > 0 && (
				<div className="rounded-lg border border-border p-4 space-y-3">
					<TriggerToggles
						items={LIFECYCLE_TRIGGERS}
						values={localLifecycleTriggers}
						onChange={setLocalLifecycleTriggers}
						idPrefix="lifecycle"
					/>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleSaveLifecycle}
							disabled={lifecycleSaving}
							className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{lifecycleSaving ? 'Saving...' : 'Save'}
						</button>
						{lifecycleSaved && <span className="text-xs text-muted-foreground">Saved</span>}
					</div>
				</div>
			)}

			{LIFECYCLE_TRIGGERS.length === 0 && (
				<p className="text-sm text-muted-foreground">No lifecycle automations configured.</p>
			)}
		</div>
	);
}
