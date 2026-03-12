import { ClaudeCodeEngine } from './claude-code/index.js';
import { LlmistEngine } from './llmist/index.js';
import { getEngine, registerEngine } from './registry.js';

export function registerBuiltInEngines(): void {
	if (!getEngine('llmist')) {
		registerEngine(new LlmistEngine());
	}
	if (!getEngine('claude-code')) {
		registerEngine(new ClaudeCodeEngine());
	}
}
