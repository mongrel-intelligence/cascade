import { getAllProjectIdsWithEmailIntegration } from '../db/repositories/settingsRepository.js';
import { submitDashboardJob } from '../queue/client.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

let timer: NodeJS.Timeout | null = null;

async function runEmailChecks(): Promise<void> {
	let projectIds: string[];
	try {
		projectIds = await getAllProjectIdsWithEmailIntegration();
	} catch (err) {
		logger.error('[EmailScheduler] Failed to query email integrations', { error: String(err) });
		return;
	}

	if (projectIds.length === 0) {
		logger.debug('[EmailScheduler] No projects with email integration, skipping');
		return;
	}

	logger.info('[EmailScheduler] Triggering email-joke checks', {
		projectCount: projectIds.length,
		projectIds,
	});

	for (const projectId of projectIds) {
		try {
			const windowId = Math.floor(Date.now() / routerConfig.emailScheduleIntervalMs);
			const jobId = `email-joke-${projectId}-${windowId}`;
			await submitDashboardJob({ type: 'manual-run', projectId, agentType: 'email-joke' }, jobId);
		} catch (err) {
			logger.error('[EmailScheduler] Failed to submit email-joke job', {
				projectId,
				error: String(err),
			});
		}
	}
}

export function startEmailScheduler(): void {
	if (timer) {
		logger.warn('[EmailScheduler] Scheduler already started');
		return;
	}
	logger.info('[EmailScheduler] Starting', { intervalMs: routerConfig.emailScheduleIntervalMs });
	void runEmailChecks();
	timer = setInterval(() => void runEmailChecks(), routerConfig.emailScheduleIntervalMs);
}

export function stopEmailScheduler(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
		logger.info('[EmailScheduler] Stopped');
	}
}
