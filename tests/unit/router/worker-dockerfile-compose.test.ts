import { describe, expect, it } from 'vitest';
import {
	CASCADE_MANAGED_LABEL,
	composeDockerfile,
	computeContentHash,
	computeFullBuildHash,
} from '../../../src/router/worker-dockerfile-compose.js';

const BASE_DIGEST = 'ghcr.io/acme/cascade-worker@sha256:abc123';

describe('composeDockerfile', () => {
	it('wraps the operator content between the pinned FROM, root/node USER switches, and managed label', () => {
		const composed = composeDockerfile('RUN apt-get install -y jq\nENV FOO=bar', BASE_DIGEST);

		expect(composed).toBe(
			`${[
				`FROM ${BASE_DIGEST}`,
				'USER root',
				'RUN apt-get install -y jq',
				'ENV FOO=bar',
				'USER node',
				`LABEL ${CASCADE_MANAGED_LABEL}`,
			].join('\n')}\n`,
		);
	});

	it('pins the FROM line to the immutable base digest ref it was given', () => {
		const composed = composeDockerfile('RUN true', BASE_DIGEST);
		const firstLine = composed.split('\n')[0];
		expect(firstLine).toBe(`FROM ${BASE_DIGEST}`);
	});

	it('emits USER root before and USER node after the operator layers', () => {
		const composed = composeDockerfile('RUN whoami', BASE_DIGEST);
		const lines = composed.trim().split('\n');
		const rootIdx = lines.indexOf('USER root');
		const runIdx = lines.indexOf('RUN whoami');
		const nodeIdx = lines.indexOf('USER node');
		expect(rootIdx).toBeGreaterThanOrEqual(0);
		expect(rootIdx).toBeLessThan(runIdx);
		expect(runIdx).toBeLessThan(nodeIdx);
	});

	it('stamps the cascade.managed=true label so the dangling reaper matches the built image', () => {
		const composed = composeDockerfile('RUN true', BASE_DIGEST);
		expect(composed).toContain(`LABEL ${CASCADE_MANAGED_LABEL}`);
	});

	it('throws when the operator content declares its own FROM instruction', () => {
		expect(() => composeDockerfile('FROM alpine:3\nRUN true', BASE_DIGEST)).toThrow(/FROM/);
	});

	it('rejects a FROM line regardless of case or leading whitespace', () => {
		expect(() => composeDockerfile('   from ubuntu:22.04', BASE_DIGEST)).toThrow(/FROM/);
		expect(() => composeDockerfile('\tFrOm scratch', BASE_DIGEST)).toThrow(/FROM/);
	});

	it('allows the word FROM inside a comment or a RUN argument (only leading FROM is rejected)', () => {
		expect(() =>
			composeDockerfile('# copied FROM upstream\nRUN echo done', BASE_DIGEST),
		).not.toThrow();
		expect(() => composeDockerfile('RUN echo "select 1 FROM t"', BASE_DIGEST)).not.toThrow();
	});

	it('normalizes CRLF line endings in the operator content', () => {
		const composed = composeDockerfile('RUN a\r\nRUN b', BASE_DIGEST);
		expect(composed).not.toContain('\r');
		expect(composed).toContain('RUN a\nRUN b');
	});
});

describe('computeContentHash', () => {
	it('is stable for the same content', () => {
		expect(computeContentHash('RUN true')).toBe(computeContentHash('RUN true'));
	});

	it('changes when the content changes', () => {
		expect(computeContentHash('RUN true')).not.toBe(computeContentHash('RUN false'));
	});

	it('returns lowercase hex sha256 (64 chars)', () => {
		expect(computeContentHash('RUN true')).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('computeFullBuildHash', () => {
	const composed = composeDockerfile('RUN true', BASE_DIGEST);

	it('is stable for the same composed content and base digest', () => {
		expect(computeFullBuildHash(composed, BASE_DIGEST)).toBe(
			computeFullBuildHash(composed, BASE_DIGEST),
		);
	});

	it('changes when the composed content changes', () => {
		const other = composeDockerfile('RUN false', BASE_DIGEST);
		expect(computeFullBuildHash(composed, BASE_DIGEST)).not.toBe(
			computeFullBuildHash(other, BASE_DIGEST),
		);
	});

	it('changes when the base digest changes (so a base bump forces a rebuild)', () => {
		expect(computeFullBuildHash(composed, BASE_DIGEST)).not.toBe(
			computeFullBuildHash(composed, 'ghcr.io/acme/cascade-worker@sha256:different'),
		);
	});

	it('returns lowercase hex sha256 (64 chars)', () => {
		expect(computeFullBuildHash(composed, BASE_DIGEST)).toMatch(/^[0-9a-f]{64}$/);
	});
});
