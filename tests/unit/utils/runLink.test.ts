import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildRunLink,
	buildWorkItemRunsLink,
	getDashboardUrl,
	shortenModelName,
} from '../../../src/utils/runLink.js';

describe('runLink utility', () => {
	describe('getDashboardUrl', () => {
		const originalEnv = process.env.CASCADE_DASHBOARD_URL;

		afterEach(() => {
			if (originalEnv === undefined) {
				process.env.CASCADE_DASHBOARD_URL = undefined;
			} else {
				process.env.CASCADE_DASHBOARD_URL = originalEnv;
			}
		});

		it('returns the CASCADE_DASHBOARD_URL env var when set', () => {
			process.env.CASCADE_DASHBOARD_URL = 'https://dashboard.example.com';
			expect(getDashboardUrl()).toBe('https://dashboard.example.com');
		});

		it('returns empty string when CASCADE_DASHBOARD_URL is not set', () => {
			process.env.CASCADE_DASHBOARD_URL = undefined;
			expect(getDashboardUrl()).toBe('');
		});
	});

	describe('shortenModelName', () => {
		it('strips openrouter prefix and sub-provider', () => {
			expect(shortenModelName('openrouter:anthropic/claude-haiku-4.5')).toBe('claude-haiku-4.5');
		});

		it('strips provider prefix only (no sub-provider slash)', () => {
			expect(shortenModelName('anthropic:claude-sonnet-4-5-20250929')).toBe(
				'claude-sonnet-4-5-20250929',
			);
		});

		it('returns model as-is when no prefix', () => {
			expect(shortenModelName('claude-haiku-4.5')).toBe('claude-haiku-4.5');
		});

		it('handles gemini models', () => {
			expect(shortenModelName('gemini:gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
		});

		it('handles openrouter google models', () => {
			expect(shortenModelName('openrouter:google/gemini-2.5-flash-lite')).toBe(
				'gemini-2.5-flash-lite',
			);
		});

		it('returns empty string for empty input', () => {
			expect(shortenModelName('')).toBe('');
		});
	});

	describe('buildRunLink', () => {
		it('builds a markdown run details link', () => {
			const result = buildRunLink({
				dashboardUrl: 'https://dashboard.example.com',
				runId: 'run-123',
				engineLabel: 'claude-code',
				model: 'anthropic:claude-haiku-4.5',
			});

			expect(result).toContain('🕵️');
			expect(result).toContain('claude-code');
			expect(result).toContain('claude-haiku-4.5');
			expect(result).toContain('[run details](https://dashboard.example.com/runs/run-123)');
		});

		it('strips trailing slash from dashboard URL', () => {
			const result = buildRunLink({
				dashboardUrl: 'https://dashboard.example.com/',
				runId: 'run-abc',
				engineLabel: 'llmist',
				model: 'gemini:gemini-2.5-flash',
			});

			expect(result).toContain('https://dashboard.example.com/runs/run-abc');
			expect(result).not.toContain('//runs/');
		});

		it('returns empty string when dashboardUrl is empty', () => {
			const result = buildRunLink({
				dashboardUrl: '',
				runId: 'run-123',
				engineLabel: 'claude-code',
				model: 'anthropic:claude-haiku-4.5',
			});

			expect(result).toBe('');
		});

		it('returns empty string when runId is empty', () => {
			const result = buildRunLink({
				dashboardUrl: 'https://dashboard.example.com',
				runId: '',
				engineLabel: 'claude-code',
				model: 'anthropic:claude-haiku-4.5',
			});

			expect(result).toBe('');
		});

		it('includes spacing newlines', () => {
			const result = buildRunLink({
				dashboardUrl: 'https://dashboard.example.com',
				runId: 'run-123',
				engineLabel: 'claude-code',
				model: 'claude-haiku-4.5',
			});

			expect(result).toMatch(/^\n\n🕵️/);
		});
	});

	describe('buildWorkItemRunsLink', () => {
		it('builds a markdown work-item-runs link', () => {
			const result = buildWorkItemRunsLink({
				dashboardUrl: 'https://dashboard.example.com',
				projectId: 'proj-1',
				workItemId: 'card-abc',
				engineLabel: 'llmist',
				model: 'openrouter:google/gemini-2.5-flash',
			});

			expect(result).toContain('🕵️');
			expect(result).toContain('llmist');
			expect(result).toContain('gemini-2.5-flash');
			expect(result).toContain(
				'[run details](https://dashboard.example.com/work-items/proj-1/card-abc)',
			);
		});

		it('returns empty string when dashboardUrl is empty', () => {
			const result = buildWorkItemRunsLink({
				dashboardUrl: '',
				projectId: 'proj-1',
				workItemId: 'card-abc',
			});

			expect(result).toBe('');
		});

		it('returns empty string when projectId is empty', () => {
			const result = buildWorkItemRunsLink({
				dashboardUrl: 'https://dashboard.example.com',
				projectId: '',
				workItemId: 'card-abc',
			});

			expect(result).toBe('');
		});

		it('returns empty string when workItemId is empty', () => {
			const result = buildWorkItemRunsLink({
				dashboardUrl: 'https://dashboard.example.com',
				projectId: 'proj-1',
				workItemId: '',
			});

			expect(result).toBe('');
		});

		it('works without optional engineLabel and model', () => {
			const result = buildWorkItemRunsLink({
				dashboardUrl: 'https://dashboard.example.com',
				projectId: 'proj-1',
				workItemId: 'card-abc',
			});

			expect(result).toContain('🕵️');
			expect(result).toContain(
				'[run details](https://dashboard.example.com/work-items/proj-1/card-abc)',
			);
		});
	});

	describe('env-var injection for subprocess agents', () => {
		let originalEnv: Record<string, string | undefined>;

		beforeEach(() => {
			originalEnv = {
				CASCADE_RUN_LINKS_ENABLED: process.env.CASCADE_RUN_LINKS_ENABLED,
				CASCADE_DASHBOARD_URL: process.env.CASCADE_DASHBOARD_URL,
				CASCADE_RUN_ID: process.env.CASCADE_RUN_ID,
				CASCADE_ENGINE_LABEL: process.env.CASCADE_ENGINE_LABEL,
				CASCADE_MODEL: process.env.CASCADE_MODEL,
				CASCADE_PROJECT_ID: process.env.CASCADE_PROJECT_ID,
				CASCADE_WORK_ITEM_ID: process.env.CASCADE_WORK_ITEM_ID,
			};
		});

		afterEach(() => {
			for (const [key, val] of Object.entries(originalEnv)) {
				if (val === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = val;
				}
			}
		});

		it('getDashboardUrl reads CASCADE_DASHBOARD_URL env var', () => {
			process.env.CASCADE_DASHBOARD_URL = 'https://my-dashboard.example.com';
			expect(getDashboardUrl()).toBe('https://my-dashboard.example.com');
		});

		it('getDashboardUrl returns empty string when unset', () => {
			process.env.CASCADE_DASHBOARD_URL = undefined;
			expect(getDashboardUrl()).toBe('');
		});
	});
});
