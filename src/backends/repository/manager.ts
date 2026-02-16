import { setupRepository } from '../../agents/shared/repository.js';
import type { createAgentLogger } from '../../agents/utils/logging.js';
import type { AgentInput, ProjectConfig } from '../../types/index.js';

/**
 * Resolve the working directory — either a pre-existing log dir or a fresh repo clone.
 */
export async function resolveRepoDir(
	input: AgentInput & { project: ProjectConfig },
	log: ReturnType<typeof createAgentLogger>,
	agentType: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		return input.logDir;
	}
	return setupRepository({
		project: input.project,
		log,
		agentType,
		prBranch: input.prBranch,
		warmTsCache: true,
	});
}
