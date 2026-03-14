import type { AgentEngine, AgentEngineDefinition } from './types.js';

const engines = new Map<string, AgentEngine>();

export function registerEngine(engine: AgentEngine): void {
	if (!engine.definition?.id) {
		throw new Error('Cannot register engine without definition.id');
	}
	engines.set(engine.definition.id, engine);
}

export function getEngine(name: string): AgentEngine | undefined {
	return engines.get(name);
}

export function getRegisteredEngines(): string[] {
	return Array.from(engines.keys());
}

export function getEngineCatalog(): AgentEngineDefinition[] {
	return Array.from(engines.values()).map((engine) => engine.definition);
}
