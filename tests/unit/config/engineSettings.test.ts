import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerBuiltInEngines } from '../../../src/backends/bootstrap.js';
import {
	EngineSettingsSchema,
	getEngineSettings,
	getEngineSettingsSchema,
	mergeEngineSettings,
	normalizeEngineSettings,
	registerEngineSettingsSchema,
} from '../../../src/config/engineSettings.js';

beforeAll(() => {
	registerBuiltInEngines();
});

describe.concurrent('registerEngineSettingsSchema / getEngineSettingsSchema', () => {
	it('stores and retrieves a registered schema', () => {
		const schema = z.object({ timeout: z.number() }) as unknown as z.ZodType<
			Record<string, unknown>
		>;
		registerEngineSettingsSchema('test-engine-register-1', schema);
		expect(getEngineSettingsSchema('test-engine-register-1')).toBe(schema);
	});

	it('returns undefined for an unknown engine ID', () => {
		expect(getEngineSettingsSchema('test-engine-nonexistent-xyz')).toBeUndefined();
	});

	it('overwrites an existing schema registration', () => {
		const schema1 = z.object({ a: z.string() }) as unknown as z.ZodType<Record<string, unknown>>;
		const schema2 = z.object({ b: z.number() }) as unknown as z.ZodType<Record<string, unknown>>;
		registerEngineSettingsSchema('test-engine-overwrite-1', schema1);
		registerEngineSettingsSchema('test-engine-overwrite-1', schema2);
		expect(getEngineSettingsSchema('test-engine-overwrite-1')).toBe(schema2);
	});
});

describe.concurrent('normalizeEngineSettings', () => {
	it('returns null for null input', () => {
		expect(normalizeEngineSettings(null)).toBeNull();
	});

	it('returns undefined for undefined input', () => {
		expect(normalizeEngineSettings(undefined)).toBeUndefined();
	});

	it('returns undefined for empty object input', () => {
		expect(normalizeEngineSettings({})).toBeUndefined();
	});

	it('strips engines whose value is undefined', () => {
		const result = normalizeEngineSettings({ 'test-engine-norm-1': undefined });
		expect(result).toBeUndefined();
	});

	it('strips engines whose settings are all undefined values', () => {
		const result = normalizeEngineSettings({
			'test-engine-norm-2': { key1: undefined, key2: undefined },
		});
		expect(result).toBeUndefined();
	});

	it('filters out undefined values within engine settings', () => {
		const result = normalizeEngineSettings({
			'test-engine-norm-3': { key1: 'value', key2: undefined, key3: 42 },
		});
		expect(result).toEqual({ 'test-engine-norm-3': { key1: 'value', key3: 42 } });
	});

	it('preserves multiple engines with valid settings', () => {
		const result = normalizeEngineSettings({
			'test-engine-norm-4': { a: 1 },
			'test-engine-norm-5': { b: 'hello' },
		});
		expect(result).toEqual({
			'test-engine-norm-4': { a: 1 },
			'test-engine-norm-5': { b: 'hello' },
		});
	});

	it('strips empty engines but keeps valid ones in mixed input', () => {
		const result = normalizeEngineSettings({
			'test-engine-norm-6': { key: 'val' },
			'test-engine-norm-7': undefined,
			'test-engine-norm-8': { empty: undefined },
		});
		expect(result).toEqual({ 'test-engine-norm-6': { key: 'val' } });
	});
});

describe.concurrent('mergeEngineSettings', () => {
	it('returns undefined when both arguments are undefined', () => {
		expect(mergeEngineSettings(undefined, undefined)).toBeUndefined();
	});

	it('returns the defined argument when defaults is undefined', () => {
		const project = { 'test-engine-merge-1': { key: 'value' } };
		expect(mergeEngineSettings(undefined, project)).toEqual(project);
	});

	it('returns the defined argument when project is undefined', () => {
		const defaults = { 'test-engine-merge-2': { key: 'value' } };
		expect(mergeEngineSettings(defaults, undefined)).toEqual(defaults);
	});

	it('project settings win over defaults for overlapping keys', () => {
		const defaults = { 'test-engine-merge-3': { key1: 'default', key2: 'defaultOnly' } };
		const project = { 'test-engine-merge-3': { key1: 'project' } };
		const result = mergeEngineSettings(defaults, project);
		expect(result).toEqual({ 'test-engine-merge-3': { key1: 'project', key2: 'defaultOnly' } });
	});

	it('merges settings from different engines', () => {
		const defaults = { 'test-engine-merge-4': { a: 1 } };
		const project = { 'test-engine-merge-5': { b: 2 } };
		const result = mergeEngineSettings(defaults, project);
		expect(result).toEqual({
			'test-engine-merge-4': { a: 1 },
			'test-engine-merge-5': { b: 2 },
		});
	});

	it('returns undefined when merged result is empty', () => {
		// Both engines have undefined-only settings that normalize away.
		// normalizeEngineSettings is called internally and strips everything.
		// Use empty objects so the type is satisfied — merging two empty objects
		// produces an empty result which normalizes to undefined.
		expect(mergeEngineSettings({}, {})).toBeUndefined();
	});
});

describe.concurrent('getEngineSettings', () => {
	it('returns undefined for null settings', () => {
		const schema = z.object({ key: z.string() });
		expect(getEngineSettings(null, 'test-engine-get-1', schema)).toBeUndefined();
	});

	it('returns undefined for undefined settings', () => {
		const schema = z.object({ key: z.string() });
		expect(getEngineSettings(undefined, 'test-engine-get-2', schema)).toBeUndefined();
	});

	it('returns undefined when engine is not present in settings', () => {
		const schema = z.object({ key: z.string() });
		const settings = { 'test-engine-get-3': { key: 'hello' } };
		expect(getEngineSettings(settings, 'test-engine-get-missing', schema)).toBeUndefined();
	});

	it('parses and returns valid engine settings', () => {
		const schema = z.object({ timeout: z.number(), label: z.string() });
		const settings = { 'test-engine-get-4': { timeout: 5000, label: 'prod' } };
		const result = getEngineSettings(settings, 'test-engine-get-4', schema);
		expect(result).toEqual({ timeout: 5000, label: 'prod' });
	});

	it('throws when engine settings fail schema validation', () => {
		const schema = z.object({ timeout: z.number() });
		const settings = { 'test-engine-get-5': { timeout: 'not-a-number' } };
		expect(() => getEngineSettings(settings, 'test-engine-get-5', schema)).toThrow();
	});
});

describe.concurrent('EngineSettingsSchema', () => {
	it('rejects settings for an unregistered engine', () => {
		const result = EngineSettingsSchema.safeParse({
			'test-engine-schema-unregistered-xyz': { foo: 'bar' },
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path[0]);
			expect(paths).toContain('test-engine-schema-unregistered-xyz');
		}
	});

	it('rejects with correct error path for unregistered engine', () => {
		const result = EngineSettingsSchema.safeParse({
			'test-engine-schema-bad-path': { x: 1 },
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path[0]).toBe('test-engine-schema-bad-path');
			expect(result.error.issues[0].message).toContain('test-engine-schema-bad-path');
		}
	});

	it('validates settings for a registered engine (codex)', () => {
		const result = EngineSettingsSchema.safeParse({
			codex: { approvalPolicy: 'never', sandboxMode: 'workspace-write' },
		});
		expect(result.success).toBe(true);
	});

	it('validates settings for a registered engine (claude-code)', () => {
		const result = EngineSettingsSchema.safeParse({
			'claude-code': {},
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid settings for a registered engine with correct error path', () => {
		// codex approvalPolicy must be 'auto' | 'on-failure' | 'never', not a random string
		const result = EngineSettingsSchema.safeParse({
			codex: { approvalPolicy: 'invalid-value' },
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path);
			// Should have error path starting with 'codex'
			expect(paths.some((p) => p[0] === 'codex')).toBe(true);
		}
	});

	it('strips empty engine entries after transformation', () => {
		// An empty object for a registered engine should be stripped by normalizeEngineSettings
		// but EngineSettingsSchema transforms to {} when all engines are empty, not undefined
		const result = EngineSettingsSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({});
		}
	});
});
