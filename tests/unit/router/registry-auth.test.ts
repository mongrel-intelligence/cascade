import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoggerWarn } = vi.hoisted(() => ({
	mockLoggerWarn: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
	},
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		workerImageRegistryUsername: 'config-user',
		workerImageRegistryPassword: 'config-pass',
		workerImageRegistryServer: undefined,
	},
}));

import {
	DOCKER_HUB_SERVER_ADDRESS,
	registryHostFromImageRef,
	resolvePullAuthConfig,
} from '../../../src/router/registry-auth.js';

const FULL_CREDS = { username: 'bot', password: 'secret', server: undefined };

describe('registryHostFromImageRef', () => {
	it('extracts a dotted registry host (ghcr.io)', () => {
		expect(registryHostFromImageRef('ghcr.io/acme/worker:latest')).toBe('ghcr.io');
	});

	it('extracts a host with an explicit port', () => {
		expect(registryHostFromImageRef('my.registry:8443/team/img:tag')).toBe('my.registry:8443');
	});

	it('treats localhost as a registry host', () => {
		expect(registryHostFromImageRef('localhost:5000/img')).toBe('localhost:5000');
	});

	it('maps a namespaced Docker Hub ref to the hub server address', () => {
		expect(registryHostFromImageRef('library/redis:7')).toBe(DOCKER_HUB_SERVER_ADDRESS);
	});

	it('maps a bare ref (tag colon is not a port) to the hub server address', () => {
		expect(registryHostFromImageRef('redis:7-alpine')).toBe(DOCKER_HUB_SERVER_ADDRESS);
	});
});

describe('resolvePullAuthConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns undefined (anonymous pull) when no credentials are configured', () => {
		expect(
			resolvePullAuthConfig('ghcr.io/acme/worker:latest', {
				username: undefined,
				password: undefined,
				server: undefined,
			}),
		).toBeUndefined();
		expect(mockLoggerWarn).not.toHaveBeenCalled();
	});

	it('builds an authconfig with the server derived from the image ref', () => {
		expect(resolvePullAuthConfig('ghcr.io/acme/worker:latest', FULL_CREDS)).toEqual({
			username: 'bot',
			password: 'secret',
			serveraddress: 'ghcr.io',
		});
	});

	it('prefers an explicit server override to derivation', () => {
		expect(
			resolvePullAuthConfig('ghcr.io/acme/worker:latest', {
				...FULL_CREDS,
				server: 'mirror.example.com',
			}),
		).toEqual({
			username: 'bot',
			password: 'secret',
			serveraddress: 'mirror.example.com',
		});
	});

	it('warns and stays anonymous when only the username is set', () => {
		expect(
			resolvePullAuthConfig('ghcr.io/acme/worker:latest', { ...FULL_CREDS, password: undefined }),
		).toBeUndefined();
		expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
	});

	it('warns and stays anonymous when only the password is set', () => {
		expect(
			resolvePullAuthConfig('ghcr.io/acme/worker:latest', { ...FULL_CREDS, username: undefined }),
		).toBeUndefined();
		expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
	});

	it('defaults credentials from routerConfig when none are passed', () => {
		expect(resolvePullAuthConfig('ghcr.io/acme/worker:latest')).toEqual({
			username: 'config-user',
			password: 'config-pass',
			serveraddress: 'ghcr.io',
		});
	});
});
