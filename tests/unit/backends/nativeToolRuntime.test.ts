import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	buildNativeToolPath,
	createNativeToolRuntimeArtifacts,
} from '../../../src/backends/nativeToolRuntime.js';

describe('createNativeToolRuntimeArtifacts', () => {
	// Track artifacts created in each test so we can clean up even if the test fails
	let cleanupFns: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanupFns) {
			try {
				cleanup();
			} catch {
				// ignore cleanup errors in afterEach
			}
		}
		cleanupFns = [];
		vi.restoreAllMocks();
	});

	it('creates a shim directory that exists on disk', () => {
		const { shimDir, cleanup } = createNativeToolRuntimeArtifacts();
		cleanupFns.push(cleanup);

		expect(existsSync(shimDir)).toBe(true);
	});

	it('creates a gh shim file inside the shim directory', () => {
		const { shimDir, cleanup } = createNativeToolRuntimeArtifacts();
		cleanupFns.push(cleanup);

		const ghPath = `${shimDir}/gh`;
		expect(existsSync(ghPath)).toBe(true);
	});

	it('gh shim is a valid shell script with the expected content', () => {
		const { shimDir, cleanup } = createNativeToolRuntimeArtifacts();
		cleanupFns.push(cleanup);

		const ghPath = `${shimDir}/gh`;
		const content = readFileSync(ghPath, 'utf-8');

		expect(content).toContain('#!/bin/sh');
		expect(content).toContain('cascade-tools');
		expect(content).toContain('exit 1');
	});

	it('gh shim has executable permissions (0o755)', () => {
		const { shimDir, cleanup } = createNativeToolRuntimeArtifacts();
		cleanupFns.push(cleanup);

		const ghPath = `${shimDir}/gh`;
		// accessSync throws if the permission check fails; we assert it doesn't throw
		expect(() => accessSync(ghPath, constants.X_OK)).not.toThrow();
	});

	it('cleanup removes the shim directory best-effort', () => {
		const { shimDir, cleanup } = createNativeToolRuntimeArtifacts();

		// Directory must exist before cleanup
		expect(existsSync(shimDir)).toBe(true);

		cleanup();

		// Directory should be gone after cleanup
		expect(existsSync(shimDir)).toBe(false);
	});

	it('cleanup does not throw even if the directory was already removed', () => {
		const { cleanup } = createNativeToolRuntimeArtifacts();
		cleanupFns.push(cleanup);

		// Remove the directory manually first
		cleanup();

		// Calling cleanup again (after removal) should not throw
		expect(() => cleanup()).not.toThrow();
	});

	it('generates unique shim directories on each call', () => {
		// Use fake timers so Date.now() advances between the two calls
		vi.useFakeTimers();

		const first = createNativeToolRuntimeArtifacts();
		cleanupFns.push(first.cleanup);

		vi.advanceTimersByTime(1);

		const second = createNativeToolRuntimeArtifacts();
		cleanupFns.push(second.cleanup);

		vi.useRealTimers();

		expect(first.shimDir).not.toBe(second.shimDir);
	});
});

describe('buildNativeToolPath', () => {
	it('places shim directory first in the resulting PATH', () => {
		const result = buildNativeToolPath('/usr/bin', '/opt/cascade-tools', '/tmp/shims');

		const parts = result.split(':');
		expect(parts[0]).toBe('/tmp/shims');
	});

	it('places cliToolsDir before basePath', () => {
		const result = buildNativeToolPath('/usr/bin', '/opt/cascade-tools', '/tmp/shims');

		const parts = result.split(':');
		const cliIdx = parts.indexOf('/opt/cascade-tools');
		const baseIdx = parts.indexOf('/usr/bin');

		expect(cliIdx).toBeGreaterThanOrEqual(0);
		expect(baseIdx).toBeGreaterThanOrEqual(0);
		expect(cliIdx).toBeLessThan(baseIdx);
	});

	it('preserves basePath at the end', () => {
		const result = buildNativeToolPath('/usr/bin:/usr/local/bin', '/opt/cascade-tools');

		expect(result).toContain('/usr/bin:/usr/local/bin');
		expect(result.endsWith('/usr/bin:/usr/local/bin')).toBe(true);
	});

	it('omits shimDir from PATH when not provided', () => {
		const result = buildNativeToolPath('/usr/bin', '/opt/cascade-tools');

		const parts = result.split(':');
		expect(parts).toHaveLength(2);
		expect(parts).toContain('/opt/cascade-tools');
		expect(parts).toContain('/usr/bin');
	});

	it('includes cliToolsDir even without shimDir or basePath', () => {
		const result = buildNativeToolPath(undefined, '/opt/cascade-tools');

		expect(result).toBe('/opt/cascade-tools');
	});

	it('filters out empty string entries', () => {
		const result = buildNativeToolPath('', '/opt/cascade-tools', '');

		const parts = result.split(':');
		expect(parts).not.toContain('');
		expect(parts).toHaveLength(1);
	});

	it('filters out undefined basePath', () => {
		const result = buildNativeToolPath(undefined, '/opt/cascade-tools', '/tmp/shims');

		const parts = result.split(':');
		expect(parts).not.toContain('undefined');
		expect(parts).toEqual(['/tmp/shims', '/opt/cascade-tools']);
	});

	it('returns correct shim-first ordering with all three entries', () => {
		const result = buildNativeToolPath('/usr/bin', '/opt/cascade-tools', '/tmp/shims');

		expect(result).toBe('/tmp/shims:/opt/cascade-tools:/usr/bin');
	});
});
