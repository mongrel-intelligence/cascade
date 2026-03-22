import { describe, expect, it } from 'vitest';
import {
	CLAUDE_CODE_ENGINE_DEFINITION,
	CODEX_ENGINE_DEFINITION,
	DEFAULT_ENGINE_CATALOG,
	LLMIST_ENGINE_DEFINITION,
	OPENCODE_ENGINE_DEFINITION,
} from '../../../src/backends/catalog.js';
import type { AgentEngineDefinition } from '../../../src/backends/types.js';

describe('DEFAULT_ENGINE_CATALOG', () => {
	it('contains exactly 4 engines', () => {
		expect(DEFAULT_ENGINE_CATALOG).toHaveLength(4);
	});

	it('contains llmist, claude-code, codex, and opencode engines', () => {
		const ids = DEFAULT_ENGINE_CATALOG.map((e) => e.id);
		expect(ids).toContain('llmist');
		expect(ids).toContain('claude-code');
		expect(ids).toContain('codex');
		expect(ids).toContain('opencode');
	});

	it('has no duplicate IDs', () => {
		const ids = DEFAULT_ENGINE_CATALOG.map((e) => e.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it('every engine has all required fields', () => {
		for (const engine of DEFAULT_ENGINE_CATALOG) {
			expect(typeof engine.id).toBe('string');
			expect(engine.id.length).toBeGreaterThan(0);
			expect(typeof engine.label).toBe('string');
			expect(engine.label.length).toBeGreaterThan(0);
			expect(typeof engine.description).toBe('string');
			expect(engine.description.length).toBeGreaterThan(0);
			expect(Array.isArray(engine.capabilities)).toBe(true);
			expect(typeof engine.modelSelection).toBe('object');
			expect(typeof engine.logLabel).toBe('string');
			expect(engine.logLabel.length).toBeGreaterThan(0);
		}
	});

	it('is ordered: claude-code, llmist, codex, opencode', () => {
		expect(DEFAULT_ENGINE_CATALOG[0].id).toBe('claude-code');
		expect(DEFAULT_ENGINE_CATALOG[1].id).toBe('llmist');
		expect(DEFAULT_ENGINE_CATALOG[2].id).toBe('codex');
		expect(DEFAULT_ENGINE_CATALOG[3].id).toBe('opencode');
	});
});

// ─── Individual engine definitions ────────────────────────────────────────────
describe('LLMIST_ENGINE_DEFINITION', () => {
	it('has correct id and label', () => {
		expect(LLMIST_ENGINE_DEFINITION.id).toBe('llmist');
		expect(LLMIST_ENGINE_DEFINITION.label).toBe('LLMist');
	});

	it('has free-text model selection', () => {
		expect(LLMIST_ENGINE_DEFINITION.modelSelection.type).toBe('free-text');
	});

	it('has expected capabilities', () => {
		expect(LLMIST_ENGINE_DEFINITION.capabilities).toContain('synthetic_tool_context');
		expect(LLMIST_ENGINE_DEFINITION.capabilities).toContain('streaming_text_events');
		expect(LLMIST_ENGINE_DEFINITION.capabilities).toContain('scoped_env_secrets');
	});

	it('does not have settings (llmist has no engine-specific settings)', () => {
		expect(LLMIST_ENGINE_DEFINITION.settings).toBeUndefined();
	});
});

describe('CLAUDE_CODE_ENGINE_DEFINITION', () => {
	it('has correct id and label', () => {
		expect(CLAUDE_CODE_ENGINE_DEFINITION.id).toBe('claude-code');
		expect(CLAUDE_CODE_ENGINE_DEFINITION.label).toBe('Claude Code');
	});

	it('has select model selection with default label', () => {
		expect(CLAUDE_CODE_ENGINE_DEFINITION.modelSelection.type).toBe('select');
		if (CLAUDE_CODE_ENGINE_DEFINITION.modelSelection.type === 'select') {
			expect(CLAUDE_CODE_ENGINE_DEFINITION.modelSelection.defaultValueLabel).toContain('Sonnet');
			expect(Array.isArray(CLAUDE_CODE_ENGINE_DEFINITION.modelSelection.options)).toBe(true);
			expect(CLAUDE_CODE_ENGINE_DEFINITION.modelSelection.options.length).toBeGreaterThan(0);
		}
	});

	it('has native file edit and external CLI capabilities', () => {
		expect(CLAUDE_CODE_ENGINE_DEFINITION.capabilities).toContain('native_file_edit_tools');
		expect(CLAUDE_CODE_ENGINE_DEFINITION.capabilities).toContain('external_cli_tools');
	});

	it('has offloaded context capabilities', () => {
		expect(CLAUDE_CODE_ENGINE_DEFINITION.capabilities).toContain('inline_prompt_context');
		expect(CLAUDE_CODE_ENGINE_DEFINITION.capabilities).toContain('offloaded_context_files');
	});

	it('has settings with title and fields', () => {
		expect(CLAUDE_CODE_ENGINE_DEFINITION.settings).toBeDefined();
		expect(CLAUDE_CODE_ENGINE_DEFINITION.settings?.title).toBe('Claude Code Settings');
		expect(Array.isArray(CLAUDE_CODE_ENGINE_DEFINITION.settings?.fields)).toBe(true);
	});

	it('settings fields include effort and thinking', () => {
		const fields = CLAUDE_CODE_ENGINE_DEFINITION.settings?.fields ?? [];
		const keys = fields.map((f) => f.key);
		expect(keys).toContain('effort');
		expect(keys).toContain('thinking');
	});

	it('effort field has correct options', () => {
		const fields = CLAUDE_CODE_ENGINE_DEFINITION.settings?.fields ?? [];
		const effortField = fields.find((f) => f.key === 'effort');
		expect(effortField).toBeDefined();
		expect(effortField?.type).toBe('select');
		const options = (effortField as { options?: { value: string }[] })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toContain('low');
		expect(values).toContain('medium');
		expect(values).toContain('high');
		expect(values).toContain('max');
	});
});

describe('CODEX_ENGINE_DEFINITION', () => {
	it('has correct id and label', () => {
		expect(CODEX_ENGINE_DEFINITION.id).toBe('codex');
		expect(CODEX_ENGINE_DEFINITION.label).toBe('Codex');
	});

	it('has select model selection with default label', () => {
		expect(CODEX_ENGINE_DEFINITION.modelSelection.type).toBe('select');
		if (CODEX_ENGINE_DEFINITION.modelSelection.type === 'select') {
			expect(CODEX_ENGINE_DEFINITION.modelSelection.defaultValueLabel).toBeDefined();
			expect(Array.isArray(CODEX_ENGINE_DEFINITION.modelSelection.options)).toBe(true);
			expect(CODEX_ENGINE_DEFINITION.modelSelection.options.length).toBeGreaterThan(0);
		}
	});

	it('has native file edit and external CLI capabilities', () => {
		expect(CODEX_ENGINE_DEFINITION.capabilities).toContain('native_file_edit_tools');
		expect(CODEX_ENGINE_DEFINITION.capabilities).toContain('external_cli_tools');
	});

	it('has settings with approvalPolicy field', () => {
		expect(CODEX_ENGINE_DEFINITION.settings).toBeDefined();
		const fields = CODEX_ENGINE_DEFINITION.settings?.fields ?? [];
		const keys = fields.map((f) => f.key);
		expect(keys).toContain('approvalPolicy');
	});

	it('approvalPolicy field has never option', () => {
		const fields = CODEX_ENGINE_DEFINITION.settings?.fields ?? [];
		const approvalField = fields.find((f) => f.key === 'approvalPolicy');
		expect(approvalField).toBeDefined();
		const options = (approvalField as { options?: { value: string }[] })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toContain('never');
	});

	it('has sandboxMode setting field', () => {
		const fields = CODEX_ENGINE_DEFINITION.settings?.fields ?? [];
		const keys = fields.map((f) => f.key);
		expect(keys).toContain('sandboxMode');
	});
});

describe('OPENCODE_ENGINE_DEFINITION', () => {
	it('has correct id and label', () => {
		expect(OPENCODE_ENGINE_DEFINITION.id).toBe('opencode');
		expect(OPENCODE_ENGINE_DEFINITION.label).toBe('OpenCode');
	});

	it('has free-text model selection', () => {
		expect(OPENCODE_ENGINE_DEFINITION.modelSelection.type).toBe('free-text');
	});

	it('has permission_policy capability', () => {
		expect(OPENCODE_ENGINE_DEFINITION.capabilities).toContain('permission_policy');
	});

	it('has native file edit and external CLI capabilities', () => {
		expect(OPENCODE_ENGINE_DEFINITION.capabilities).toContain('native_file_edit_tools');
		expect(OPENCODE_ENGINE_DEFINITION.capabilities).toContain('external_cli_tools');
	});

	it('has settings with webSearch field', () => {
		expect(OPENCODE_ENGINE_DEFINITION.settings).toBeDefined();
		const fields = OPENCODE_ENGINE_DEFINITION.settings?.fields ?? [];
		const keys = fields.map((f) => f.key);
		expect(keys).toContain('webSearch');
	});

	it('webSearch field is a boolean type', () => {
		const fields = OPENCODE_ENGINE_DEFINITION.settings?.fields ?? [];
		const webSearchField = fields.find((f) => f.key === 'webSearch');
		expect(webSearchField?.type).toBe('boolean');
	});
});

// ─── Cross-cutting properties ─────────────────────────────────────────────────
describe('Engine definitions cross-cutting properties', () => {
	it('all engines have scoped_env_secrets capability', () => {
		for (const engine of DEFAULT_ENGINE_CATALOG) {
			expect(engine.capabilities).toContain('scoped_env_secrets');
		}
	});

	it('native-tool engines have streaming_text_events and streaming_tool_events', () => {
		const nativeToolEngines: AgentEngineDefinition[] = [
			CLAUDE_CODE_ENGINE_DEFINITION,
			CODEX_ENGINE_DEFINITION,
			OPENCODE_ENGINE_DEFINITION,
		];
		for (const engine of nativeToolEngines) {
			expect(engine.capabilities).toContain('streaming_text_events');
			expect(engine.capabilities).toContain('streaming_tool_events');
		}
	});

	it('native-tool engines have external_cli_tools capability', () => {
		const nativeToolEngines = [
			CLAUDE_CODE_ENGINE_DEFINITION,
			CODEX_ENGINE_DEFINITION,
			OPENCODE_ENGINE_DEFINITION,
		];
		for (const engine of nativeToolEngines) {
			expect(engine.capabilities).toContain('external_cli_tools');
		}
	});

	it('all settings fields have key, label, and type', () => {
		for (const engine of DEFAULT_ENGINE_CATALOG) {
			if (!engine.settings) continue;
			for (const field of engine.settings.fields) {
				expect(typeof field.key).toBe('string');
				expect(field.key.length).toBeGreaterThan(0);
				expect(typeof field.label).toBe('string');
				expect(field.label.length).toBeGreaterThan(0);
				expect(typeof field.type).toBe('string');
				expect(field.type.length).toBeGreaterThan(0);
			}
		}
	});

	it('select-type settings fields have a non-empty options array', () => {
		for (const engine of DEFAULT_ENGINE_CATALOG) {
			if (!engine.settings) continue;
			for (const field of engine.settings.fields) {
				if (field.type === 'select') {
					const opts = (field as { options?: unknown[] }).options;
					expect(Array.isArray(opts)).toBe(true);
					expect((opts as unknown[]).length).toBeGreaterThan(0);
				}
			}
		}
	});
});
