import { describe, expect, it } from 'vitest';

import { isValidImageReference } from '../../../src/config/workerImageRef.js';

/**
 * Spec 022 plan 3/4 — synchronous worker-image reference grammar gate.
 */

describe('isValidImageReference', () => {
	it.each([
		'ghcr.io/mongrel-intelligence/cascade-worker:latest',
		'cascade-worker:local',
		'cascade-worker',
		'ghcr.io/acme/cascade-worker',
		'registry:5000/team/worker:latest',
		'docker.io/library/ubuntu:22.04',
		'ghcr.io/acme/cascade-worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
		'my-registry.example.com/path/to/image:v1.2.3',
	])('accepts valid reference %s', (ref) => {
		expect(isValidImageReference(ref)).toBe(true);
	});

	it.each([
		'Not A Ref!!',
		'',
		'   ',
		'has space:tag',
		'image:tag!!',
		'image:',
		':tag',
		'image@sha256:short',
		'repo/',
		'bad..repo:tag',
	])('rejects invalid reference %p', (ref) => {
		expect(isValidImageReference(ref)).toBe(false);
	});

	it('trims surrounding whitespace before validating', () => {
		expect(isValidImageReference('  cascade-worker:local  ')).toBe(true);
	});

	it('rejects a pathologically long reference', () => {
		expect(isValidImageReference(`a${'b'.repeat(600)}:tag`)).toBe(false);
	});
});
