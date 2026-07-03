/**
 * Pure Dockerfile-composition + hashing helpers for the router-side worker-image
 * build engine (spec 023 plan 3/5).
 *
 * This module is intentionally Docker-free and side-effect-free so the compose
 * shape and the two hash functions can be unit-tested without a daemon. The
 * actual `docker build` lives in `worker-image-build.ts` behind an injectable
 * dep.
 *
 * Two DISTINCT hashes are computed here; do not conflate them:
 *
 *   - **content-hash** = `sha256(raw operator content)` — the value persisted in
 *     `worker_image_build_hash`, the build job's payload identity, and the
 *     supersede guard. Computed by the set surface (plan 4) which has no Docker
 *     access, and by anything that needs to detect "did the desired content
 *     change". See {@link computeContentHash}.
 *   - **full-hash** = `sha256(composed Dockerfile + base digest)` — stamped on the
 *     built image as the `cascade.build_hash` label and used ONLY for the
 *     content-hash-reuse fast path (skip `docker build` when an intact local
 *     image already carries a matching label). Because it folds in the resolved
 *     base digest, changing the global base image yields a different full-hash ⇒
 *     a rebuild. See {@link computeFullBuildHash}.
 */

import { createHash } from 'node:crypto';

/** Label baked into every built image so the dangling-image reaper can match it. */
export const CASCADE_MANAGED_LABEL = 'cascade.managed=true';

/** Label key stamping the full-hash on a built image for the reuse fast path. */
export const CASCADE_BUILD_HASH_LABEL_KEY = 'cascade.build_hash';

/**
 * Throw when the operator content declares its own `FROM` instruction.
 *
 * Operators supply EXTRA layers only — CASCADE prepends the pinned base `FROM`
 * itself (so the base is always the audited, digest-pinned global worker image).
 * A content-supplied `FROM` would let an operator escape the pinned base
 * entirely, so it is rejected defensively at compose time (and again at set time
 * in plan 4). Comment lines (`# ...`) and blank lines are ignored; the match is
 * case-insensitive and tolerant of leading whitespace.
 */
function assertNoFromLine(content: string): void {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		if (/^FROM(\s|$)/i.test(line)) {
			throw new Error(
				'worker Dockerfile content must not contain its own FROM instruction; ' +
					'CASCADE prepends the pinned base image automatically (operators supply extra layers only)',
			);
		}
	}
}

/**
 * Compose the operator's extra-layer content onto the pinned base image.
 *
 * Emits, in order:
 *
 *   FROM <baseDigestRef>      # the immutable `repo@sha256:...` base pin
 *   USER root                 # operator layers run as root (installs, copies)
 *   <operator content>        # verbatim extra layers (RUN / COPY / ENV / ...)
 *   USER node                 # drop back to the unprivileged runtime user
 *   LABEL cascade.managed=true # so the dangling-image reaper matches rebuilds
 *
 * `baseDigestRef` MUST already be an immutable `repo@sha256:...` reference (the
 * caller resolves it). Throws via {@link assertNoFromLine} when `content`
 * declares its own `FROM`.
 */
export function composeDockerfile(content: string, baseDigestRef: string): string {
	assertNoFromLine(content);
	const operatorLines = content.replace(/\r\n/g, '\n').trim();
	const parts = [
		`FROM ${baseDigestRef}`,
		'USER root',
		...(operatorLines ? [operatorLines] : []),
		'USER node',
		`LABEL ${CASCADE_MANAGED_LABEL}`,
	];
	return `${parts.join('\n')}\n`;
}

/**
 * The content-hash: `sha256(raw operator content)` as lowercase hex.
 *
 * Stable and total — the same content always hashes to the same value. This is
 * the persisted `worker_image_build_hash` + build-job identity + supersede guard.
 */
export function computeContentHash(content: string): string {
	return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * The full-hash: `sha256(composed Dockerfile + base digest)` as lowercase hex.
 *
 * Changes whenever the composed content OR the resolved base digest changes, so a
 * base-image bump (different digest) forces a rebuild even for identical operator
 * content. Stamped as the `cascade.build_hash` label and compared in the reuse
 * fast path. The two inputs are separated by a NUL byte so no pair of distinct
 * (composed, digest) inputs can collide by concatenation.
 */
export function computeFullBuildHash(composed: string, baseDigestRef: string): string {
	return createHash('sha256')
		.update(composed, 'utf-8')
		.update('\0')
		.update(baseDigestRef, 'utf-8')
		.digest('hex');
}
