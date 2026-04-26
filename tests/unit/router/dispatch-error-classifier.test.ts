import { describe, expect, it } from 'vitest';

import { classifyDispatchError } from '../../../src/router/dispatch-error-classifier.js';

describe('classifyDispatchError', () => {
	it("Docker daemon unreachable (ECONNREFUSED) → 'transient'", () => {
		const err = Object.assign(new Error('connect ECONNREFUSED /var/run/docker.sock'), {
			code: 'ECONNREFUSED',
		});
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("Docker socket reset (ECONNRESET) → 'transient'", () => {
		const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("DNS lookup failure (ENOTFOUND) → 'transient'", () => {
		const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("registry rate-limit (HTTP 429) → 'transient'", () => {
		const err = Object.assign(new Error('toomanyrequests: Rate limit'), { statusCode: 429 });
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("container name collision (HTTP 409 'name already in use') → 'transient'", () => {
		const err = Object.assign(
			new Error('(HTTP code 409) The container name "/x" is already in use'),
			{ statusCode: 409 },
		);
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("image not found after fallback (404 + 'no such image') → 'terminal'", () => {
		const err = Object.assign(new Error('(HTTP code 404) No such image: foo:latest'), {
			statusCode: 404,
		});
		expect(classifyDispatchError(err)).toBe('terminal');
	});

	it("validation error (TypeError) → 'terminal'", () => {
		expect(classifyDispatchError(new TypeError("Cannot read 'foo' of undefined"))).toBe('terminal');
	});

	it("slot-wait timeout (code: 'SLOT_WAIT_TIMEOUT') → 'transient'", () => {
		const err = Object.assign(new Error('Slot wait timed out'), { code: 'SLOT_WAIT_TIMEOUT' });
		expect(classifyDispatchError(err)).toBe('transient');
	});

	it("unknown error (no recognizable shape) → 'transient' (default-to-retry)", () => {
		expect(classifyDispatchError(new Error('something weird'))).toBe('transient');
	});

	it("ZodError-shaped (name='ZodError') → 'terminal'", () => {
		const err = Object.assign(new Error('validation failed'), { name: 'ZodError' });
		expect(classifyDispatchError(err)).toBe('terminal');
	});

	it("non-Error values → 'transient' (default-to-retry, never crash the classifier)", () => {
		expect(classifyDispatchError('plain string')).toBe('transient');
		expect(classifyDispatchError(null)).toBe('transient');
		expect(classifyDispatchError(undefined)).toBe('transient');
	});
});
