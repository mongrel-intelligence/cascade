export { getPMProvider, getPMProviderOrNull, withPMProvider } from './context.js';
// PMIntegration interface + registry
export type { PMIntegration, PMWebhookEvent } from './integration.js';
export { hasPmIntegration } from './integration.js';
export { JiraPMProvider } from './jira/adapter.js';
export type { ProjectPMConfig } from './lifecycle.js';
export { hasAutoLabel, PMLifecycleManager, resolveProjectPMConfig } from './lifecycle.js';
export {
	extractMarkdownImages,
	filterImageMedia,
	isImageMimeType,
	MAX_IMAGE_SIZE_BYTES,
	MAX_IMAGES_PER_WORK_ITEM,
} from './media.js';
export { pmRegistry } from './registry.js';
export { TrelloPMProvider } from './trello/adapter.js';
export type {
	Attachment,
	Checklist,
	ChecklistItem,
	CreateWorkItemConfig,
	MediaReference,
	PMProvider,
	PMType,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from './types.js';
export { processPMWebhook } from './webhook-handler.js';

import { integrationRegistry } from '../integrations/registry.js';
import type { ProjectConfig } from '../types/index.js';
import { JiraIntegration } from './jira/integration.js';
import { pmRegistry } from './registry.js';
// Register built-in integrations at import time
import { TrelloIntegration } from './trello/integration.js';
import type { PMProvider } from './types.js';

const trelloIntegration = new TrelloIntegration();
pmRegistry.register(trelloIntegration);
if (!integrationRegistry.getOrNull('trello')) integrationRegistry.register(trelloIntegration);

const jiraIntegration = new JiraIntegration();
pmRegistry.register(jiraIntegration);
if (!integrationRegistry.getOrNull('jira')) integrationRegistry.register(jiraIntegration);

export function createPMProvider(project: ProjectConfig): PMProvider {
	return pmRegistry.createProvider(project);
}
