export { getPMProvider, getPMProviderOrNull, withPMProvider } from './context.js';
// PMIntegration interface + registry
export type { PMIntegration, PMWebhookEvent } from './integration.js';
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

import type { ProjectConfig } from '../types/index.js';
import { pmRegistry } from './registry.js';
import type { PMProvider } from './types.js';

export function createPMProvider(project: ProjectConfig): PMProvider {
	return pmRegistry.createProvider(project);
}
