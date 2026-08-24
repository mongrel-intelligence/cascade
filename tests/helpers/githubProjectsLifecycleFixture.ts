/**
 * GitHub Projects lifecycle fixture for the behavioral conformance harness.
 *
 * Returns an in-memory PMProvider labeled `type: 'github-projects'` (via the
 * shared fake) that the harness exercises through `runLifecycleScenario`.
 */

import type { PMProvider } from '../../src/pm/types.js';
import { createFakePMProvider } from './fakePMProvider.js';

export async function githubProjectsLifecycleFixture(): Promise<{
	provider: PMProvider;
	containerId: string;
}> {
	const { provider } = createFakePMProvider();
	return {
		provider,
		containerId: 'fake-container-a',
	};
}
