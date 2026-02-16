/**
 * Factory for creating PM providers based on project configuration.
 */

import type { ProjectConfig } from '../types/index.js';
import { JiraPMProvider } from './jira/adapter.js';
import { TrelloPMProvider } from './trello/adapter.js';
import type { PMProvider } from './types.js';

export function createPMProvider(project: ProjectConfig): PMProvider {
	const pmType = project.pm?.type ?? 'trello';

	switch (pmType) {
		case 'trello':
			return new TrelloPMProvider();
		case 'jira': {
			if (!project.jira) {
				throw new Error(`Project '${project.id}' has pm.type=jira but no jira config`);
			}
			return new JiraPMProvider(project.jira);
		}
		default:
			throw new Error(`Unknown PM type: ${pmType}`);
	}
}
