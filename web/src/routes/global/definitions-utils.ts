const STATUS_CHANGED_EVENT = 'pm:status-changed';

export function getStatusDispatchAgentTypes(
	definitions: ReadonlyArray<{
		agentType: string;
		definition: { triggers: ReadonlyArray<{ event: string }> };
	}>,
): string[] {
	return definitions
		.filter((row) =>
			row.definition.triggers.some((trigger) => trigger.event === STATUS_CHANGED_EVENT),
		)
		.map((row) => row.agentType)
		.sort();
}
