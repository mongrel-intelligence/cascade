import { afterEach, describe, expect, it } from 'vitest';
import {
	isAnalysisRunning,
	markAnalysisComplete,
	markAnalysisRunning,
} from '../../../src/triggers/shared/debug-status.js';

describe('debug-status tracker', () => {
	afterEach(() => {
		// Clean up any leftover state
		markAnalysisComplete('run-1');
		markAnalysisComplete('run-2');
	});

	it('reports idle by default', () => {
		expect(isAnalysisRunning('run-1')).toBe(false);
	});

	it('marks a run as running', () => {
		markAnalysisRunning('run-1');
		expect(isAnalysisRunning('run-1')).toBe(true);
	});

	it('marks a run as complete', () => {
		markAnalysisRunning('run-1');
		markAnalysisComplete('run-1');
		expect(isAnalysisRunning('run-1')).toBe(false);
	});

	it('tracks multiple runs independently', () => {
		markAnalysisRunning('run-1');
		markAnalysisRunning('run-2');

		expect(isAnalysisRunning('run-1')).toBe(true);
		expect(isAnalysisRunning('run-2')).toBe(true);

		markAnalysisComplete('run-1');
		expect(isAnalysisRunning('run-1')).toBe(false);
		expect(isAnalysisRunning('run-2')).toBe(true);
	});

	it('is idempotent for markAnalysisRunning', () => {
		markAnalysisRunning('run-1');
		markAnalysisRunning('run-1');
		expect(isAnalysisRunning('run-1')).toBe(true);

		markAnalysisComplete('run-1');
		expect(isAnalysisRunning('run-1')).toBe(false);
	});

	it('is safe to call markAnalysisComplete on non-running run', () => {
		markAnalysisComplete('run-1');
		expect(isAnalysisRunning('run-1')).toBe(false);
	});
});
