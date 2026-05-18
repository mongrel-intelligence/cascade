interface StatusTriggerInput {
	readonly key: string;
	readonly agentType: string | null;
	readonly isBuiltin: boolean;
}

interface ExistingTriggerInput {
	readonly agentType: string;
	readonly triggerEvent: string;
}

const AUTO_ENABLED_BUILTIN_STATUS_KEYS = new Set(['splitting', 'planning', 'todo']);

export function buildMissingStatusTriggerConfigs(args: {
	readonly statusMappings: Readonly<Record<string, string>>;
	readonly workflowStatuses: ReadonlyArray<StatusTriggerInput>;
	readonly existingConfigs: ReadonlyArray<ExistingTriggerInput>;
}): Array<{
	agentType: string;
	triggerEvent: 'pm:status-changed';
	enabled: true;
}> {
	const mappedKeys = new Set(
		Object.entries(args.statusMappings)
			.filter(([, providerStateId]) => providerStateId)
			.map(([key]) => key),
	);
	const existing = new Set(
		args.existingConfigs.map((config) => `${config.agentType}:${config.triggerEvent}`),
	);
	const seenAgents = new Set<string>();

	return args.workflowStatuses.flatMap((status) => {
		if (!status.agentType || !mappedKeys.has(status.key)) return [];
		if (status.isBuiltin && !AUTO_ENABLED_BUILTIN_STATUS_KEYS.has(status.key)) return [];
		if (seenAgents.has(status.agentType)) return [];
		seenAgents.add(status.agentType);
		if (existing.has(`${status.agentType}:pm:status-changed`)) return [];
		return [
			{
				agentType: status.agentType,
				triggerEvent: 'pm:status-changed',
				enabled: true,
			},
		];
	});
}
