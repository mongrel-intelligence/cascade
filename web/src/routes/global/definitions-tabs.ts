export const AGENT_DEFINITIONS_TABS = ['definitions', 'partials', 'workflow-statuses'] as const;

export type AgentDefinitionsTab = (typeof AGENT_DEFINITIONS_TABS)[number];
