import { describe, expect, it } from 'vitest';
import { formatError, formatSuccess } from '../../../src/cli/_shared/output.js';

describe('formatSuccess', () => {
	it('returns JSON with success=true and object data', () => {
		const result = JSON.parse(formatSuccess({ foo: 'bar' }));
		expect(result).toEqual({ success: true, data: { foo: 'bar' } });
	});

	it('returns JSON with success=true and string data', () => {
		const result = JSON.parse(formatSuccess('hello'));
		expect(result).toEqual({ success: true, data: 'hello' });
	});

	it('returns JSON with success=true and null data', () => {
		const result = JSON.parse(formatSuccess(null));
		expect(result).toEqual({ success: true, data: null });
	});

	it('pretty-prints with 2-space indent', () => {
		const output = formatSuccess({ a: 1 });
		expect(output).toBe(JSON.stringify({ success: true, data: { a: 1 } }, null, 2));
	});
});

describe('formatError', () => {
	it('extracts message from Error instance', () => {
		const result = JSON.parse(formatError(new Error('something broke')));
		expect(result).toEqual({ success: false, error: 'something broke' });
	});

	it('stringifies non-Error values', () => {
		const result = JSON.parse(formatError('raw string'));
		expect(result).toEqual({ success: false, error: 'raw string' });
	});

	it('stringifies numeric values', () => {
		const result = JSON.parse(formatError(42));
		expect(result).toEqual({ success: false, error: '42' });
	});

	it('returns JSON with success=false', () => {
		const result = JSON.parse(formatError(new Error('fail')));
		expect(result.success).toBe(false);
	});
});
