import { describe, expect, it } from 'vitest';
import {
	EmailJokeTriggerConfigSchema,
	parseEmailJokeTriggers,
	resolveEmailJokeTriggerConfig,
} from '../../../src/config/triggerConfig.js';

describe('EmailJokeTriggerConfigSchema', () => {
	it('accepts valid email address', () => {
		const result = EmailJokeTriggerConfigSchema.parse({ senderEmail: 'test@example.com' });
		expect(result.senderEmail).toBe('test@example.com');
	});

	it('accepts null senderEmail', () => {
		const result = EmailJokeTriggerConfigSchema.parse({ senderEmail: null });
		expect(result.senderEmail).toBeNull();
	});

	it('accepts undefined/missing senderEmail', () => {
		const result = EmailJokeTriggerConfigSchema.parse({});
		expect(result.senderEmail).toBeUndefined();
	});

	it('rejects invalid email address', () => {
		expect(() => EmailJokeTriggerConfigSchema.parse({ senderEmail: 'not-an-email' })).toThrow();
	});
});

describe('resolveEmailJokeTriggerConfig', () => {
	it('returns senderEmail when provided', () => {
		const result = resolveEmailJokeTriggerConfig({ senderEmail: 'test@example.com' });
		expect(result.senderEmail).toBe('test@example.com');
	});

	it('returns undefined senderEmail when not provided', () => {
		const result = resolveEmailJokeTriggerConfig(undefined);
		expect(result.senderEmail).toBeUndefined();
	});

	it('returns undefined senderEmail for empty object', () => {
		const result = resolveEmailJokeTriggerConfig({});
		expect(result.senderEmail).toBeUndefined();
	});

	it('converts null senderEmail to undefined', () => {
		const result = resolveEmailJokeTriggerConfig({ senderEmail: null });
		expect(result.senderEmail).toBeUndefined();
	});
});

describe('parseEmailJokeTriggers', () => {
	it('parses valid trigger object', () => {
		const result = parseEmailJokeTriggers({ senderEmail: 'test@example.com' });
		expect(result.senderEmail).toBe('test@example.com');
	});

	it('returns empty config for null input', () => {
		const result = parseEmailJokeTriggers(null);
		expect(result.senderEmail).toBeUndefined();
	});

	it('returns empty config for undefined input', () => {
		const result = parseEmailJokeTriggers(undefined);
		expect(result.senderEmail).toBeUndefined();
	});

	it('returns empty config for non-object input', () => {
		const result = parseEmailJokeTriggers('not an object');
		expect(result.senderEmail).toBeUndefined();
	});

	it('returns empty config for invalid email', () => {
		const result = parseEmailJokeTriggers({ senderEmail: 'invalid' });
		expect(result.senderEmail).toBeUndefined();
	});

	it('handles null senderEmail in valid object', () => {
		const result = parseEmailJokeTriggers({ senderEmail: null });
		expect(result.senderEmail).toBeNull();
	});
});
