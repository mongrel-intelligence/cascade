import type { AgentBackend } from './types.js';

const backends = new Map<string, AgentBackend>();

export function registerBackend(backend: AgentBackend): void {
	backends.set(backend.name, backend);
}

export function getBackend(name: string): AgentBackend | undefined {
	return backends.get(name);
}

export function getRegisteredBackends(): string[] {
	return Array.from(backends.keys());
}
