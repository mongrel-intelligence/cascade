import { registerEngineSettingsSchema } from '../config/engineSettings.js';
import { ClaudeCodeEngine } from './claude-code/index.js';
import { CodexEngine } from './codex/index.js';
import { LlmistEngine } from './llmist/index.js';
import { OpenCodeEngine } from './opencode/index.js';
import { getEngine, registerEngine } from './registry.js';

function registerEngineWithSettings(engine: import('./types.js').AgentEngine): void {
	registerEngine(engine);
	if (engine.getSettingsSchema) {
		registerEngineSettingsSchema(engine.definition.id, engine.getSettingsSchema());
	}
}

export function registerBuiltInEngines(): void {
	if (!getEngine('llmist')) {
		registerEngineWithSettings(new LlmistEngine());
	}
	if (!getEngine('claude-code')) {
		registerEngineWithSettings(new ClaudeCodeEngine());
	}
	if (!getEngine('codex')) {
		registerEngineWithSettings(new CodexEngine());
	}
	if (!getEngine('opencode')) {
		registerEngineWithSettings(new OpenCodeEngine());
	}
}
