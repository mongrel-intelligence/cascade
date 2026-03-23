import { describe, expect, it } from 'vitest';
import {
	buildEngineResult,
	extractAndBuildPrEvidence,
} from '../../../src/backends/shared/engineResult.js';

// ---------------------------------------------------------------------------
// buildEngineResult
// ---------------------------------------------------------------------------

describe('buildEngineResult', () => {
	it('builds a minimal success result', () => {
		const result = buildEngineResult({ success: true, output: 'all done' });
		expect(result).toEqual({ success: true, output: 'all done' });
	});

	it('builds a minimal failure result', () => {
		const result = buildEngineResult({ success: false, output: '' });
		expect(result).toEqual({ success: false, output: '' });
	});

	it('includes error when provided', () => {
		const result = buildEngineResult({ success: false, output: '', error: 'something failed' });
		expect(result.error).toBe('something failed');
	});

	it('omits error field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'ok' });
		expect(result).not.toHaveProperty('error');
	});

	it('includes cost when provided', () => {
		const result = buildEngineResult({ success: true, output: 'ok', cost: 0.0042 });
		expect(result.cost).toBe(0.0042);
	});

	it('omits cost field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'ok' });
		expect(result).not.toHaveProperty('cost');
	});

	it('includes prUrl when provided', () => {
		const prUrl = 'https://github.com/owner/repo/pull/7';
		const result = buildEngineResult({ success: true, output: 'done', prUrl });
		expect(result.prUrl).toBe(prUrl);
	});

	it('omits prUrl field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'done' });
		expect(result).not.toHaveProperty('prUrl');
	});

	it('includes prEvidence when provided', () => {
		const prEvidence = { source: 'text' as const, authoritative: false };
		const result = buildEngineResult({ success: true, output: 'done', prEvidence });
		expect(result.prEvidence).toEqual(prEvidence);
	});

	it('omits prEvidence field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'done' });
		expect(result).not.toHaveProperty('prEvidence');
	});

	it('includes logBuffer when provided', () => {
		const logBuffer = Buffer.from('log data');
		const result = buildEngineResult({ success: true, output: 'done', logBuffer });
		expect(result.logBuffer).toBe(logBuffer);
	});

	it('omits logBuffer field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'done' });
		expect(result).not.toHaveProperty('logBuffer');
	});

	it('includes runId when provided', () => {
		const result = buildEngineResult({ success: true, output: 'done', runId: 'run-abc' });
		expect(result.runId).toBe('run-abc');
	});

	it('omits runId field when undefined', () => {
		const result = buildEngineResult({ success: true, output: 'done' });
		expect(result).not.toHaveProperty('runId');
	});

	it('assembles a full result with all optional fields', () => {
		const prEvidence = { source: 'text' as const, authoritative: false };
		const result = buildEngineResult({
			success: true,
			output: 'completed',
			prUrl: 'https://github.com/owner/repo/pull/42',
			prEvidence,
			cost: 1.5,
			error: undefined,
			runId: 'run-123',
		});
		expect(result).toEqual({
			success: true,
			output: 'completed',
			prUrl: 'https://github.com/owner/repo/pull/42',
			prEvidence,
			cost: 1.5,
			runId: 'run-123',
		});
	});
});

// ---------------------------------------------------------------------------
// extractAndBuildPrEvidence
// ---------------------------------------------------------------------------

describe('extractAndBuildPrEvidence', () => {
	it('extracts a PR URL from text and returns matching evidence', () => {
		const text = 'PR created: https://github.com/owner/repo/pull/42 — done';
		const { prUrl, prEvidence } = extractAndBuildPrEvidence(text);
		expect(prUrl).toBe('https://github.com/owner/repo/pull/42');
		expect(prEvidence).toEqual({ source: 'text', authoritative: false });
	});

	it('returns undefined prUrl and undefined prEvidence when no URL in text', () => {
		const { prUrl, prEvidence } = extractAndBuildPrEvidence('No PR found here.');
		expect(prUrl).toBeUndefined();
		expect(prEvidence).toBeUndefined();
	});

	it('returns undefined prUrl and prEvidence for empty string', () => {
		const { prUrl, prEvidence } = extractAndBuildPrEvidence('');
		expect(prUrl).toBeUndefined();
		expect(prEvidence).toBeUndefined();
	});

	it('prEvidence.source is "text" when URL is found', () => {
		const { prEvidence } = extractAndBuildPrEvidence('https://github.com/owner/repo/pull/1');
		expect(prEvidence?.source).toBe('text');
	});

	it('prEvidence.authoritative is false when URL is found', () => {
		const { prEvidence } = extractAndBuildPrEvidence('https://github.com/owner/repo/pull/1');
		expect(prEvidence?.authoritative).toBe(false);
	});

	it('extracts the first PR URL when multiple are present in the text', () => {
		const text =
			'First: https://github.com/owner/repo/pull/1 Second: https://github.com/owner/repo/pull/2';
		const { prUrl } = extractAndBuildPrEvidence(text);
		expect(prUrl).toBe('https://github.com/owner/repo/pull/1');
	});

	it('works correctly when passed a bare URL string (already extracted URL)', () => {
		// Engines may pass an already-extracted URL back through this helper
		const { prUrl, prEvidence } = extractAndBuildPrEvidence(
			'https://github.com/owner/repo/pull/99',
		);
		expect(prUrl).toBe('https://github.com/owner/repo/pull/99');
		expect(prEvidence).toEqual({ source: 'text', authoritative: false });
	});

	it('prEvidence is undefined when prUrl is undefined', () => {
		const { prUrl, prEvidence } = extractAndBuildPrEvidence('no url here');
		expect(prUrl).toBeUndefined();
		expect(prEvidence).toBeUndefined();
	});
});
