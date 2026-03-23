/**
 * Permission configuration and resolution for OpenCode engine runs.
 *
 * Builds the permission config from agent capabilities and resolves
 * per-request permission decisions during a session.
 */

import type { Config, Permission } from '@opencode-ai/sdk/client';

export type PermissionDecision = 'allow' | 'deny';

export type OpenCodePermissionConfig = NonNullable<Config['permission']>;

export function buildPermissionConfig(
	nativeToolCapabilities: string[] | undefined,
	webSearch: boolean,
): OpenCodePermissionConfig {
	const canWrite = nativeToolCapabilities?.includes('fs:write') ?? false;
	const canExec = nativeToolCapabilities?.includes('shell:exec') ?? false;

	return {
		edit: canWrite ? 'allow' : 'deny',
		bash: canExec ? 'allow' : 'deny',
		webfetch: webSearch ? 'allow' : 'deny',
		doom_loop: 'deny',
		external_directory: 'deny',
	};
}

export function normalizePermissionDecision(decision: PermissionDecision): 'always' | 'reject' {
	return decision === 'allow' ? 'always' : 'reject';
}

export function resolvePermissionDecision(
	permission: Pick<Permission, 'type'>,
	config: OpenCodePermissionConfig,
): PermissionDecision {
	switch (permission.type) {
		case 'edit':
			return config.edit === 'allow' ? 'allow' : 'deny';
		case 'bash':
			return config.bash === 'allow' ? 'allow' : 'deny';
		case 'webfetch':
			return config.webfetch === 'allow' ? 'allow' : 'deny';
		case 'external_directory':
			return config.external_directory === 'allow' ? 'allow' : 'deny';
		case 'doom_loop':
			return config.doom_loop === 'allow' ? 'allow' : 'deny';
		default:
			return 'deny';
	}
}
