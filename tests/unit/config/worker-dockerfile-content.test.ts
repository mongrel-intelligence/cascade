import { describe, expect, it } from 'vitest';

import {
	validateWorkerDockerfileContent,
	WORKER_DOCKERFILE_MAX_BYTES,
} from '../../../src/config/workerDockerfileContent.js';

/**
 * Spec 023 plan 4 — synchronous worker-Dockerfile content gate. Rejects empty,
 * over-cap, and any operator-supplied `FROM` (CASCADE owns the base image).
 */

describe('validateWorkerDockerfileContent', () => {
	describe('valid content', () => {
		it.each([
			'RUN apt-get update && apt-get install -y jq',
			'COPY ./tools /opt/tools',
			'ENV FOO=bar\nRUN echo hi',
			'# a comment then a real layer\nRUN echo hi',
			'RUN echo "the word FROM appears mid-line"',
			'RUN pip install requests',
		])('accepts %p', (content) => {
			expect(validateWorkerDockerfileContent(content)).toEqual({ valid: true });
		});
	});

	describe('empty / whitespace', () => {
		it.each(['', '   ', '\n\n', '\t  \n  '])('rejects empty/whitespace %p', (content) => {
			const result = validateWorkerDockerfileContent(content);
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/empty/i);
		});
	});

	describe('over-cap (byte length)', () => {
		it('rejects content over the byte cap', () => {
			const oversize = `RUN echo ${'a'.repeat(WORKER_DOCKERFILE_MAX_BYTES)}`;
			const result = validateWorkerDockerfileContent(oversize);
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/byte/i);
		});

		it('measures UTF-8 bytes, not code points (multi-byte chars count fully)', () => {
			// Each '€' is 3 UTF-8 bytes. A string of just under MAX/3 code points of
			// '€' exceeds the byte cap while its `.length` (code points) is under it.
			const codePoints = Math.ceil(WORKER_DOCKERFILE_MAX_BYTES / 3) + 10;
			const content = `RUN echo ${'€'.repeat(codePoints)}`;
			expect(content.length).toBeLessThan(WORKER_DOCKERFILE_MAX_BYTES);
			expect(validateWorkerDockerfileContent(content).valid).toBe(false);
		});

		it('accepts content exactly at the byte cap', () => {
			const prefix = 'RUN echo ';
			const filler = 'a'.repeat(WORKER_DOCKERFILE_MAX_BYTES - prefix.length);
			const content = `${prefix}${filler}`;
			expect(Buffer.byteLength(content, 'utf-8')).toBe(WORKER_DOCKERFILE_MAX_BYTES);
			expect(validateWorkerDockerfileContent(content).valid).toBe(true);
		});
	});

	describe('reject FROM (any line, case-insensitive)', () => {
		it.each([
			'FROM node:20',
			'from ubuntu:22.04',
			'  FROM alpine',
			'\tFROM scratch',
			'RUN echo hi\nFROM node:20',
			'RUN echo hi\n   from  node:20  AS build',
			'FROM',
		])('rejects content declaring its own FROM %p', (content) => {
			const result = validateWorkerDockerfileContent(content);
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/FROM/i);
		});

		it('does not reject FROM inside a comment', () => {
			expect(validateWorkerDockerfileContent('# FROM node:20\nRUN echo hi')).toEqual({
				valid: true,
			});
		});

		it('does not reject the word FROM mid-instruction', () => {
			expect(validateWorkerDockerfileContent('RUN cp --from=/a /b')).toEqual({ valid: true });
		});
	});
});
