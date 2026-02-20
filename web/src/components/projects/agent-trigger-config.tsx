import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { TriggerAgentMapping } from '@/lib/trigger-agent-mapping.js';
import { getMappingsForAgent } from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface AgentTriggerConfigProps {
	projectId: string;
	agentType: string;
	/** Current integration configs (trello + jira) */
	trelloConfig?: Record<string, unknown>;
	jiraConfig?: Record<string, unknown>;
}

function buildInitialValues(
	configurableMappings: TriggerAgentMapping[],
	trelloConfig?: Record<string, unknown>,
	jiraConfig?: Record<string, unknown>,
): Record<string, string> {
	const initial: Record<string, string> = {};
	for (const mapping of configurableMappings) {
		const config = mapping.source === 'trello' ? trelloConfig : jiraConfig;
		const sourceKey = mapping.source === 'trello' ? 'lists' : 'statuses';
		const section = config?.[sourceKey] as Record<string, string> | undefined;
		initial[`${mapping.source}:${mapping.configKey}`] = section?.[mapping.configKey] ?? '';
	}
	return initial;
}

function TriggerField({
	mapping,
	value,
	onChange,
}: {
	mapping: TriggerAgentMapping;
	value: string;
	onChange: (v: string) => void;
}) {
	const key = `${mapping.source}:${mapping.configKey}`;
	return (
		<div className="space-y-1">
			<Label htmlFor={`trigger-${key}`} className="text-sm">
				{mapping.fieldLabel}
				<span className="ml-2 text-xs text-muted-foreground font-normal">
					({mapping.source === 'trello' ? 'Trello' : 'JIRA'})
				</span>
			</Label>
			<p className="text-xs text-muted-foreground">{mapping.description}</p>
			<Input
				id={`trigger-${key}`}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={mapping.fieldType === 'trello-list' ? 'Trello list ID' : 'JIRA status name'}
				className="max-w-sm"
			/>
		</div>
	);
}

/**
 * Displays and allows editing of trigger configuration for a specific agent type.
 * Shows configurable fields (Trello list IDs, JIRA statuses) inline.
 * GitHub triggers are shown as read-only descriptions.
 */
export function AgentTriggerConfig({
	projectId,
	agentType,
	trelloConfig,
	jiraConfig,
}: AgentTriggerConfigProps) {
	const queryClient = useQueryClient();
	const mappings = getMappingsForAgent(agentType);

	// Separate configurable from read-only (cheap filter, no memoization needed)
	const configurableMappings = mappings.filter((m) => m.configurable);
	const readOnlyMappings = mappings.filter((m) => !m.configurable);

	// Build initial values for configurable fields (derived from configs)
	const initialValues = buildInitialValues(configurableMappings, trelloConfig, jiraConfig);

	const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialValues);
	const [saved, setSaved] = useState(false);

	const saveMutation = useMutation({
		mutationFn: async () => {
			await saveConfigChanges(
				projectId,
				configurableMappings,
				fieldValues,
				trelloConfig,
				jiraConfig,
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		},
	});

	if (mappings.length === 0) {
		return null;
	}

	return (
		<div className="space-y-4 border-t border-border pt-4 mt-4">
			<h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
				Trigger Configuration
			</h4>

			{configurableMappings.length > 0 && (
				<div className="space-y-3">
					{configurableMappings.map((mapping) => {
						const key = `${mapping.source}:${mapping.configKey}`;
						return (
							<TriggerField
								key={key}
								mapping={mapping}
								value={fieldValues[key] ?? ''}
								onChange={(v) => setFieldValues((prev) => ({ ...prev, [key]: v }))}
							/>
						);
					})}

					<div className="flex items-center gap-2 pt-1">
						<button
							type="button"
							onClick={() => saveMutation.mutate()}
							disabled={saveMutation.isPending}
							className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{saveMutation.isPending ? 'Saving...' : 'Save Trigger Config'}
						</button>
						{saved && <span className="text-sm text-muted-foreground">Saved</span>}
						{saveMutation.isError && (
							<span className="text-sm text-destructive">{saveMutation.error.message}</span>
						)}
					</div>
				</div>
			)}

			{readOnlyMappings.length > 0 && (
				<div className="space-y-2">
					{readOnlyMappings.map((mapping) => (
						<div
							key={`${mapping.source}:${mapping.configKey}`}
							className="flex items-start gap-2 text-sm"
						>
							<span className="shrink-0 mt-0.5 h-4 w-4 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
								↯
							</span>
							<div>
								<span className="font-medium">{mapping.triggerName}</span>
								<span className="ml-2 text-muted-foreground">— {mapping.description}</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

async function saveConfigChanges(
	projectId: string,
	configurableMappings: TriggerAgentMapping[],
	fieldValues: Record<string, string>,
	trelloConfig?: Record<string, unknown>,
	jiraConfig?: Record<string, unknown>,
) {
	const trelloChanges: Record<string, string> = {};
	const jiraChanges: Record<string, string> = {};

	for (const mapping of configurableMappings) {
		const key = `${mapping.source}:${mapping.configKey}`;
		const value = fieldValues[key] ?? '';
		if (mapping.source === 'trello') {
			trelloChanges[mapping.configKey] = value;
		} else if (mapping.source === 'jira') {
			jiraChanges[mapping.configKey] = value;
		}
	}

	if (Object.keys(trelloChanges).length > 0) {
		const existingLists = (trelloConfig?.lists as Record<string, string>) ?? {};
		await trpcClient.projects.integrations.upsert.mutate({
			projectId,
			type: 'trello',
			config: {
				...trelloConfig,
				lists: { ...existingLists, ...trelloChanges },
			},
		});
	}

	if (Object.keys(jiraChanges).length > 0) {
		const existingStatuses = (jiraConfig?.statuses as Record<string, string>) ?? {};
		await trpcClient.projects.integrations.upsert.mutate({
			projectId,
			type: 'jira',
			config: {
				...jiraConfig,
				statuses: { ...existingStatuses, ...jiraChanges },
			},
		});
	}
}
