import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { massageBooleanFlagValues } from '../../../../../src/gadgets/shared/cli/booleanArgv.js';
import type { ErrorSink } from '../../../../../src/gadgets/shared/cli/errorSink.js';

function makeSink(): ErrorSink {
	return {
		stdout: new Writable({
			write(_chunk, _enc, cb) {
				cb();
			},
		}),
		stderr: new Writable({
			write(_chunk, _enc, cb) {
				cb();
			},
		}),
		exit: vi.fn<(code: number) => never>(() => {
			throw new Error('exit');
		}),
	};
}

describe('CLI boolean argv normalization', () => {
	it('rewrites natural boolean value forms to oclif toggles', () => {
		const flags = new Map([
			['enabled', true],
			['draft', false],
		]);
		expect(
			massageBooleanFlagValues(
				['--enabled', 'true', '--enabled=false', '--draft', 'false', '--draft=true'],
				flags,
				makeSink(),
			),
		).toEqual(['--enabled', '--no-enabled', '--draft']);
	});

	it('leaves a bare toggle untouched when the next token is another flag', () => {
		expect(
			massageBooleanFlagValues(
				['--enabled', '--name', 'x'],
				new Map([['enabled', true]]),
				makeSink(),
			),
		).toEqual(['--enabled', '--name', 'x']);
	});

	it('emits through the sink on malformed boolean values', () => {
		expect(() =>
			massageBooleanFlagValues(['--enabled', 'banana'], new Map([['enabled', true]]), makeSink()),
		).toThrow('exit');
	});
});
