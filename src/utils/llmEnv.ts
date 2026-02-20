import { getOrgCredential } from '../config/provider.js';
import { logger } from './logging.js';

// Keys that llmist reads from process.env for provider discovery
const LLM_ENV_KEYS = ['OPENROUTER_API_KEY'] as const;

export async function injectLlmApiKeys(projectId: string): Promise<() => void> {
	const snapshot: Record<string, string | undefined> = {};

	for (const key of LLM_ENV_KEYS) {
		snapshot[key] = process.env[key];
		const value = await getOrgCredential(projectId, key);
		if (value) {
			process.env[key] = value;
			logger.debug('Injected LLM API key from DB', { key, projectId });
		}
	}

	return () => {
		for (const key of LLM_ENV_KEYS) {
			if (snapshot[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = snapshot[key];
			}
		}
	};
}
