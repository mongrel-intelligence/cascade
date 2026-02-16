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
export { createPMProvider } from './factory.js';
export { TrelloPMProvider } from './trello/adapter.js';
export { JiraPMProvider } from './jira/adapter.js';
export { PMLifecycleManager, resolveProjectPMConfig } from './lifecycle.js';
export type { ProjectPMConfig } from './lifecycle.js';
