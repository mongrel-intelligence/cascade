import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendEngineLog } from '../../../src/backends/shared/engineLog.js';

vi.mock('node:fs', () => ({
	appendFileSync: vi.fn(),
}));

describe('appendEngineLog (shared)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('is a no-op when path is undefined', () => {
		appendEngineLog(undefined, 'some log chunk');
		expect(appendFileSync).not.toHaveBeenCalled();
	});

	it('is a no-op when chunk is empty string', () => {
		appendEngineLog('/tmp/engine.log', '');
		expect(appendFileSync).not.toHaveBeenCalled();
	});

	it('writes to file when path and chunk are both provided', () => {
		appendEngineLog('/tmp/engine.log', 'hello\n');
		expect(appendFileSync).toHaveBeenCalledOnce();
		expect(appendFileSync).toHaveBeenCalledWith('/tmp/engine.log', 'hello\n', 'utf-8');
	});
});
