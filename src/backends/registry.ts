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

/**
 * Returns true if the given engine definition has the 'native-tool' archetype.
 */
export function isNativeToolEngineDefinition(def: AgentEngineDefinition): boolean {
	return def.archetype === 'native-tool';
}

/**
 * Returns true if the engine with the given ID is registered and has the 'native-tool' archetype.
 */
export function isNativeToolEngine(engineId: string): boolean {
	const engine = engines.get(engineId);
	if (!engine) return false;
	return isNativeToolEngineDefinition(engine.definition);
}
