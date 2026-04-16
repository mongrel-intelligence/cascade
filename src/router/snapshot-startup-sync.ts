/**
 * Snapshot startup reconciliation.
 *
 * Called once at router boot. Lists all `cascade-snapshot-*` images currently
 * on disk and registers each one as a "discovered" snapshot in the in-memory
 * registry, so the regular cleanup loop can apply TTL/max-count/max-size
 * policies to them.
 *
 * Without this, every snapshot for a work item that never re-runs is orphaned
 * forever (the in-memory registry is process-local; restarts wipe it). Exactly
 * the leak that filled the dev disk to 100% with 40 GB of three-week-old
 * llmist Trello snapshots.
 *
 * Best-effort: a Docker outage at boot must not block router startup.
 */

import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { runSnapshotCleanup } from './snapshot-cleanup.js';
import { registerDiscoveredSnapshot } from './snapshot-manager.js';

const SNAPSHOT_IMAGE_PREFIX = 'cascade-snapshot-';

const docker = new Docker();

interface DockerImageSummary {
	RepoTags?: string[] | null;
	Created: number;
	Size: number;
}

function isCascadeSnapshotTag(tag: string): boolean {
	return tag.startsWith(SNAPSHOT_IMAGE_PREFIX);
}

/**
 * Discover existing snapshot images on disk and register them. Always runs the
 * cleanup sweep at the end so TTL/max-count/max-size policies apply
 * immediately to whatever was just registered (and to anything left over from
 * a previous run that the registry already knew about).
 */
export async function syncSnapshotsFromDocker(): Promise<void> {
	let registered = 0;
	try {
		const images = (await docker.listImages()) as DockerImageSummary[];
		for (const img of images) {
			const tags = img.RepoTags ?? [];
			for (const tag of tags) {
				if (!isCascadeSnapshotTag(tag)) continue;
				registerDiscoveredSnapshot(tag, new Date(img.Created * 1000), img.Size);
				registered++;
			}
		}
		logger.info('[SnapshotStartupSync] Reconciled snapshot images from Docker:', { registered });
	} catch (err) {
		logger.warn('[SnapshotStartupSync] Failed to sync snapshots from Docker:', {
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'snapshot_startup_sync' },
			level: 'warning',
		});
	}

	await runSnapshotCleanup();
}
