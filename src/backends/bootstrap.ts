import { ClaudeCodeEngine } from './claude-code/index.js';
import { CodexEngine } from './codex/index.js';
import { LlmistEngine } from './llmist/index.js';
import { getEngine, registerEngine } from './registry.js';

export function registerBuiltInEngines(): void {
	if (!getEngine('llmist')) {
		registerEngine(new LlmistEngine());
	}
	if (!getEngine('claude-code')) {
		registerEngine(new ClaudeCodeEngine());
	}
	if (!getEngine('codex')) {
		registerEngine(new CodexEngine());
	}
}
