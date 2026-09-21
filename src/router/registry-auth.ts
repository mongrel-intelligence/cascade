/**
 * Optional registry authentication for router-side image pulls.
 *
 * Every registry pull the router performs (spawn self-heal in
 * container-manager.ts, worker-image validation, Dockerfile-build base
 * refresh) goes through dockerode, which sends NO credentials unless an
 * explicit authconfig accompanies the request — the Docker daemon has no
 * ambient login of its own, and the host's `~/.docker/config.json` is a
 * CLI-side concept the Engine API never reads. Anonymous pulls therefore 401
 * against private registries: verified live 2026-08-20 when a weekly host
 * prune removed the worker image and every spawn failed on the anonymous
 * re-pull with `Head .../manifests/latest: unauthorized`.
 *
 * Set `WORKER_IMAGE_REGISTRY_USERNAME` + `WORKER_IMAGE_REGISTRY_PASSWORD`
 * (a PAT works as the password for ghcr.io) to authenticate pulls;
 * `WORKER_IMAGE_REGISTRY_SERVER` overrides the registry host otherwise
 * derived from the image reference. Leaving them unset preserves the
 * historical anonymous behavior.
 */

import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

/** Docker Hub's canonical auth server address (what `docker login` records for hub images). */
export const DOCKER_HUB_SERVER_ADDRESS = 'https://index.docker.io/v1/';

export interface RegistryPullCredentials {
	username: string | undefined;
	password: string | undefined;
	/** Explicit registry server override; derived from the image ref when unset. */
	server: string | undefined;
}

/** Shape dockerode expects as `authconfig` on pull options. */
export interface PullAuthConfig {
	username: string;
	password: string;
	serveraddress: string;
}

/**
 * Registry host for an image reference, per Docker's reference grammar: the
 * first path segment is a registry host only when it contains a dot or a
 * port colon or is exactly `localhost`; otherwise the ref is a Docker Hub
 * image (`redis:7`, `library/redis` — a tag colon never marks a host).
 */
export function registryHostFromImageRef(imageRef: string): string {
	const firstSegment = imageRef.split('/')[0] ?? '';
	const looksLikeHost =
		imageRef.includes('/') &&
		(firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');
	return looksLikeHost ? firstSegment : DOCKER_HUB_SERVER_ADDRESS;
}

/**
 * Build the dockerode authconfig for a pull, or `undefined` for an anonymous
 * pull. Partial credentials (only one of username/password) are an operator
 * misconfiguration: warn loudly and fall back to anonymous so pulls of public
 * images keep working while the 401 on private ones stays attributable.
 */
export function resolvePullAuthConfig(
	imageRef: string,
	creds: RegistryPullCredentials = {
		username: routerConfig.workerImageRegistryUsername,
		password: routerConfig.workerImageRegistryPassword,
		server: routerConfig.workerImageRegistryServer,
	},
): PullAuthConfig | undefined {
	const { username, password, server } = creds;
	if (!username && !password) return undefined;
	if (!username || !password) {
		logger.warn(
			'[RegistryAuth] Partial worker-image registry credentials ignored — set BOTH WORKER_IMAGE_REGISTRY_USERNAME and WORKER_IMAGE_REGISTRY_PASSWORD; pulling anonymously',
			{ imageRef },
		);
		return undefined;
	}
	return { username, password, serveraddress: server || registryHostFromImageRef(imageRef) };
}
