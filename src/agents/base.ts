import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir, cloneRepo, createTempDir } from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';

export interface AgentContext {
	project: ProjectConfig;
	config: CascadeConfig;
	cardId: string;
	repoDir: string;
}

export interface AgentRunner {
	name: string;
	run: (ctx: AgentContext) => Promise<AgentResult>;
}

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId } = input;

	if (!cardId) {
		return { success: false, output: '', error: 'No card ID provided' };
	}

	let repoDir: string | null = null;

	try {
		// Clone repo to temp directory
		repoDir = createTempDir(project.id);
		cloneRepo(project, repoDir);

		logger.info('Running agent', { agentType, cardId, repoDir });

		// Get system prompt and model for future llmist integration
		const systemPrompt = project.prompts?.[agentType] || getSystemPrompt(agentType);
		const model = project.model || config.defaults.model;

		// TODO: Implement actual llmist agent execution
		// For now, return a placeholder
		logger.warn('Agent execution not yet implemented - placeholder response', {
			promptLength: systemPrompt.length,
		});

		return {
			success: true,
			output: `Agent ${agentType} would run here with model ${model}`,
		};
	} catch (err) {
		logger.error('Agent execution failed', { agentType, error: String(err) });
		return {
			success: false,
			output: '',
			error: String(err),
		};
	} finally {
		// Cleanup temp directory
		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
	}
}
