export type {
	PMProvider,
	PMType,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
	Checklist,
	ChecklistItem,
	Attachment,
	CreateWorkItemConfig,
} from './types.js';

export { withPMProvider, getPMProvider, getPMProviderOrNull } from './context.js';
export { TrelloPMProvider } from './trello/adapter.js';
export { JiraPMProvider } from './jira/adapter.js';
export { PMLifecycleManager, resolveProjectPMConfig } from './lifecycle.js';
export type { ProjectPMConfig } from './lifecycle.js';

// PMIntegration interface + registry
export type { PMIntegration, PMWebhookEvent } from './integration.js';
export { pmRegistry } from './registry.js';
export { processPMWebhook } from './webhook-handler.js';

import type { ProjectConfig } from '../types/index.js';
import { JiraIntegration } from './jira/integration.js';
import { pmRegistry } from './registry.js';
// Register built-in integrations at import time
import { TrelloIntegration } from './trello/integration.js';
import type { PMProvider } from './types.js';
pmRegistry.register(new TrelloIntegration());
pmRegistry.register(new JiraIntegration());

export function createPMProvider(project: ProjectConfig): PMProvider {
	return pmRegistry.createProvider(project);
}
