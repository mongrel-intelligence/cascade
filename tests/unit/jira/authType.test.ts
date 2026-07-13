import { describe, expect, it } from 'vitest';
import { type JiraAuthType, normalizeJiraAuthType } from '../../../src/jira/authType.js';

describe('normalizeJiraAuthType (MNG-1741)', () => {
	it("returns 'scoped' only for the exact 'scoped' value", () => {
		expect(normalizeJiraAuthType('scoped')).toBe('scoped');
	});

	it("returns 'basic' for the explicit 'basic' value", () => {
		expect(normalizeJiraAuthType('basic')).toBe('basic');
	});

	it("falls back to 'basic' when the value is absent (undefined)", () => {
		// Preserves pre-MNG-1736 behavior for projects that never set authType.
		expect(normalizeJiraAuthType(undefined)).toBe('basic');
	});

	it("falls back to 'basic' when the value is null", () => {
		expect(normalizeJiraAuthType(null)).toBe('basic');
	});

	it("falls back to 'basic' for an empty string", () => {
		expect(normalizeJiraAuthType('')).toBe('basic');
	});

	it("falls back to 'basic' for unrecognized values (no bearer/oauth expansion — MNG-1735)", () => {
		expect(normalizeJiraAuthType('bearer')).toBe('basic');
		expect(normalizeJiraAuthType('oauth')).toBe('basic');
		expect(normalizeJiraAuthType('SCOPED')).toBe('basic'); // case-sensitive
		expect(normalizeJiraAuthType(' scoped ')).toBe('basic'); // no trimming
	});

	it('always returns a value inside the JiraAuthType union', () => {
		const result: JiraAuthType = normalizeJiraAuthType('anything');
		expect(['basic', 'scoped']).toContain(result);
	});
});
