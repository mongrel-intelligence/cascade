/**
 * Generic router-side webhook processor.
 *
 * Implements the common pipeline:
 *   parse → filter → self-check → reaction → resolve config →
 *   credential scope + dispatch → ack → build job → pre-actions → queue
 *
 * Each platform provides a `RouterPlatformAdapter` that implements
 * the platform-specific steps. Mirrors the `processPMWebhook()` pattern
 * from `pm/webhook-handler.ts` but for the router (enqueue-only) path.
 */

import { getCoalesceWindowMs } from '../pm/coalesce-config.js';
import { captureException } from '../sentry.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import { logger } from '../utils/logging.js';
import { isDuplicateAction, markActionProcessed } from './action-dedup.js';
import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	clearRecentlyDispatched,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from './agent-type-lock.js';
import { classifyLockState } from './lock-state-classifier.js';
import type { RouterPlatformAdapter } from './platform-adapter.js';
import { addJob, scheduleCoalescedJob } from './queue.js';
import { clearWorkItemEnqueued, isWorkItemLocked, markWorkItemEnqueued } from './work-item-lock.js';

export interface ProcessRouterWebhookResult {
	/** Whether the event was of a processable type for this platform. */
	shouldProcess: boolean;
	/** The resolved project identifier, if any. */
	projectId?: string;
	/** Human-readable explanation of why the event was processed or skipped. */
	decisionReason?: string;
}

/**
 * Process a single incoming webhook through the full router pipeline.
 *
 * 1.  Parse payload into a normalized `ParsedWebhookEvent`
 * 2.  Action-level dedup (skip duplicate webhook deliveries)
 * 3.  Check if the event type is processable
 * 4.  Check for self-authored events (loop prevention)
 * 5.  Fire acknowledgment reaction (fire-and-forget)
 * 6.  Resolve project config
 * 7.  Dispatch triggers with platform credential scope
 * 8.  Work-item concurrency lock check
 * 9.  Post acknowledgment comment (ack info available at build time)
 * 10. Build job (with ack info embedded)
 * 11. Fire optional pre-actions (e.g. GitHub 👀 reaction)
 * 12. Enqueue job to Redis (durable)
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook pipeline with sequential guard checks
export async function processRouterWebhook(
	adapter: RouterPlatformAdapter,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<ProcessRouterWebhookResult> {
	// Step 1: Parse
	const event = await adapter.parseWebhook(payload);
	if (!event) {
		logger.debug(`Ignoring ${adapter.type} event (unparseable or not processable)`);
		return { shouldProcess: false, decisionReason: 'Event unparseable or not processable' };
	}

	// Step 2: Action-level deduplication (handles duplicate webhook deliveries)
	if (event.actionId) {
		if (isDuplicateAction(event.actionId)) {
			logger.info(`Ignoring duplicate ${adapter.type} action`, {
				actionId: event.actionId,
				eventType: event.eventType,
				workItemId: event.workItemId,
			});
			return { shouldProcess: false, decisionReason: 'Duplicate action' };
		}
		markActionProcessed(event.actionId);
	}

	// Step 3: Filter
	if (!adapter.isProcessableEvent(event)) {
		logger.debug(`Ignoring ${adapter.type} event`, { eventType: event.eventType });
		return {
			shouldProcess: false,
			decisionReason: `Event type not processable: ${event.eventType}`,
		};
	}

	// Step 4: Self-authored check
	if (await adapter.isSelfAuthored(event, payload)) {
		logger.info(`Ignoring self-authored ${adapter.type} event`, {
			eventType: event.eventType,
			projectIdentifier: event.projectIdentifier,
		});
		return { shouldProcess: true, decisionReason: 'Self-authored event (loop prevention)' };
	}

	// Step 5: Fire acknowledgment reaction (fire-and-forget)
	adapter.sendReaction(event, payload);

	// Step 6: Resolve project config
	const project = await adapter.resolveProject(event);
	if (!project) {
		logger.info(`No project config found for ${adapter.type} event`, {
			projectIdentifier: event.projectIdentifier,
		});
		return {
			shouldProcess: true,
			decisionReason: `No project config for identifier ${event.projectIdentifier ?? '(unknown)'}`,
		};
	}

	// Step 7: Dispatch triggers with credential scope
	let result = null;
	try {
		result = await adapter.dispatchWithCredentials(event, payload, project, triggerRegistry);
	} catch (err) {
		logger.warn(`${adapter.type} trigger dispatch failed (non-fatal)`, {
			error: String(err),
			projectId: project.id,
		});
	}

	if (!result) {
		logger.info(`No trigger matched for ${adapter.type} event`, {
			eventType: event.eventType,
			workItemId: event.workItemId,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'No trigger matched for event',
		};
	}

	// Structured skip — a matched handler ran but bailed (e.g. precondition
	// unmet, dedup claim lost, PR not from cascade persona). Surface the
	// handler-specific reason in webhook log decisionReason so operators can
	// triage from the dashboard without trawling cascade-router process logs.
	if (result.skipReason && result.agentType === null) {
		logger.info(`${adapter.type} trigger self-skipped`, {
			handler: result.skipReason.handler,
			message: result.skipReason.message,
			eventType: event.eventType,
			workItemId: event.workItemId,
			projectId: project.id,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: `Trigger ${result.skipReason.handler} skipped: ${result.skipReason.message}`,
		};
	}

	logger.info(`${adapter.type} trigger matched`, {
		agentType: result.agentType || '(no agent)',
		workItemId: event.workItemId,
		projectId: project.id,
	});

	// Step 7b: BullMQ delayed-job coalescing for PM status-change sequences.
	//
	// Any dispatch for the same coalesceKey (${projectId}:${workItemId}) within
	// the settle window supersedes the prior pending dispatch — regardless of
	// agent type or whether the event is a create vs. update. The ack comment
	// is deferred to job fire time (pendingAck=true) so no orphaned ack comment
	// is left behind when a job is superseded.
	if (result.coalesceKey && result.agentType) {
		const windowMs = getCoalesceWindowMs();
		if (windowMs > 0) {
			// Build the job without ack info (ack will be posted at fire time).
			const job = adapter.buildJob(event, payload, project, result, undefined);

			// Attach the deferred-ack marker. Store workItemTitle as a context
			// hint (not a literal comment) — the worker calls generateAckMessage()
			// at fire time to produce a proper role-aware ack message. Storing
			// the title lets generateAckMessage fall back gracefully when the
			// full payload context extractor returns nothing.
			if (job.type === 'trello' || job.type === 'jira' || job.type === 'linear') {
				job.pendingAck = true;
				job.ackContextHint = result.workItemTitle ?? undefined;
			}

			// Schedule as a delayed BullMQ job; supersedes any prior pending job
			// with the same key so only the latest event fires within the window.
			// Each schedule produces a UNIQUE jobId — active/completed/failed jobs
			// for the same coalesceKey do NOT block a new schedule (the prior
			// deterministic-id design silently dropped events; see the
			// `scheduleCoalescedJob` JSDoc for the live MNG-422 incident).
			try {
				const { superseded, supersededJobData } = await scheduleCoalescedJob(
					job,
					result.coalesceKey,
					windowMs,
				);

				if (superseded) {
					logger.info(`${adapter.type} coalesced dispatch superseded prior pending job`, {
						agentType: result.agentType,
						workItemId: result.workItemId,
						projectId: project.id,
						coalesceKey: result.coalesceKey,
					});
					// Release in-memory locks for the superseded job to prevent phantom
					// lock entries from accumulating. existing.remove() removes the
					// delayed BullMQ entry but does NOT fire worker.on('failed'), so
					// releaseLocksForFailedJob is never called for the superseded job.
					// Manually undo the lock marks from the previous webhook invocation.
					if (supersededJobData && supersededJobData.type !== 'github') {
						const oldAgentType = supersededJobData.triggerResult?.agentType;
						const oldWorkItemId = supersededJobData.triggerResult?.workItemId;
						if (oldAgentType) {
							if (oldWorkItemId) {
								clearWorkItemEnqueued(supersededJobData.projectId, oldWorkItemId, oldAgentType);
							}
							clearAgentTypeEnqueued(supersededJobData.projectId, oldAgentType);
							clearRecentlyDispatched(supersededJobData.projectId, oldAgentType, oldWorkItemId);
						}
					}
				} else {
					logger.info(`${adapter.type} coalesced dispatch scheduled`, {
						agentType: result.agentType,
						workItemId: result.workItemId,
						projectId: project.id,
						coalesceKey: result.coalesceKey,
						delayMs: windowMs,
					});
				}
			} catch (err) {
				result.onBlocked?.();
				// Other dispatch-failure paths flow through BullMQ retry →
				// `worker.on('failed')` → `releaseLocksForFailedJob` → Sentry
				// (per spec 015 plan 1). This catch handles a Redis-side failure
				// BEFORE the job is enqueued, so it bypasses that pipeline. Capture
				// to Sentry directly under a stable tag so coalesce-scheduling
				// failures don't silently escape observability.
				captureException(err instanceof Error ? err : new Error(String(err)), {
					tags: { source: 'coalesce_schedule_failure' },
					extra: {
						projectId: project.id,
						workItemId: result.workItemId,
						agentType: result.agentType,
						coalesceKey: result.coalesceKey,
						adapterType: adapter.type,
					},
				});
				logger.error(`Failed to schedule coalesced ${adapter.type} job`, {
					error: String(err),
					coalesceKey: result.coalesceKey,
					workItemId: result.workItemId,
				});
				return {
					shouldProcess: true,
					projectId: project.id,
					decisionReason: 'Failed to schedule coalesced job to Redis',
				};
			}

			// Mark locks for the newly-scheduled job exactly as the non-coalesced
			// path does. (The activeExists early-return above ensures we only reach
			// this point when a real new job was added to the queue.)
			if (result.workItemId) {
				markWorkItemEnqueued(project.id, result.workItemId, result.agentType);
			}
			markRecentlyDispatched(project.id, result.agentType, result.workItemId);
			markAgentTypeEnqueued(project.id, result.agentType);

			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: `Coalesced dispatch scheduled: ${result.agentType} agent for work item ${result.workItemId ?? '(unknown)'}`,
			};
		}
	}

	// GitHub special case: no-agent triggers (pr-merged, pr-ready-to-merge)
	// dispatch already performed PM operations — no job queuing needed
	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Trigger completed without agent (PM operation)',
		};
	}

	// Step 8: Work-item concurrency lock
	if (result.workItemId) {
		const lockStatus = await isWorkItemLocked(project.id, result.workItemId, result.agentType);
		if (lockStatus.locked) {
			result.onBlocked?.();
			logger.info(`Skipping ${adapter.type} job — work item already locked`, {
				source: adapter.type,
				projectId: project.id,
				workItemId: result.workItemId,
				blockedAgentType: result.agentType,
				reason: lockStatus.reason,
			});
			// Spec 015/1: distinguish "queued behind a real active dispatch" from
			// "lock leaked by a prior dispatch failure". Defaults to awaiting-slot
			// on classifier error so a transient infra blip doesn't mis-fire the
			// canary.
			const classification = await classifyLockState({
				projectId: project.id,
				workItemId: result.workItemId,
				agentType: result.agentType,
			});
			const reasonSuffix = lockStatus.reason ?? 'active run exists';
			if (classification === 'wedged') {
				// Regression invariant: after spec 015/1 ships, this should never
				// fire under normal operation. Capture loudly so any leak is
				// observable in production.
				captureException(
					new Error(
						`wedged work-item lock: projectId=${project.id} workItemId=${result.workItemId} agentType=${result.agentType}`,
					),
					{
						tags: { source: 'wedged_lock_canary' },
						extra: {
							projectId: project.id,
							workItemId: result.workItemId,
							agentType: result.agentType,
							reason: lockStatus.reason,
						},
					},
				);
				return {
					shouldProcess: true,
					projectId: project.id,
					decisionReason: `Work item locked (no active dispatch): ${reasonSuffix}`,
				};
			}
			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: `Awaiting worker slot: ${reasonSuffix}`,
			};
		}
	}

	// Step 8b: Agent-type concurrency limit
	let agentTypeMaxConcurrency: number | null = null;
	if (result.agentType) {
		const concurrencyCheck = await checkAgentTypeConcurrency(
			project.id,
			result.agentType,
			adapter.type,
			result.workItemId,
		);
		agentTypeMaxConcurrency = concurrencyCheck.maxConcurrency;
		if (concurrencyCheck.blocked) {
			result.onBlocked?.();
			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: 'Agent type concurrency limit reached',
			};
		}
	}

	try {
		// Step 9: Post acknowledgment comment — ack info is now available at build time
		// Pass the full triggerResult so PM-focused agents (e.g. backlog-manager) can
		// route the ack to the PM tool (Trello/JIRA card) instead of a GitHub PR.
		const ackResult = await adapter.postAck(event, payload, project, result.agentType, result);
		if (ackResult?.commentId != null) {
			logger.info(`${adapter.type} ack comment posted`, {
				ackCommentId: ackResult.commentId,
				workItemId: event.workItemId,
			});
		} else {
			logger.debug(
				`${adapter.type} ack returned no comment ID (worker will run without pre-seeded comment)`,
				{
					workItemId: event.workItemId,
				},
			);
		}

		// Step 10: Build job with ack info embedded
		const job = adapter.buildJob(event, payload, project, result, ackResult);

		// Step 11: Fire optional pre-actions (fire-and-forget)
		adapter.firePreActions?.(job, payload);

		// Step 12: Enqueue — job is now durable in Redis
		const jobId = await addJob(job);
		if (result.workItemId) {
			markWorkItemEnqueued(project.id, result.workItemId, result.agentType);
		}
		if (result.agentType && agentTypeMaxConcurrency !== null) {
			markRecentlyDispatched(project.id, result.agentType, result.workItemId);
			markAgentTypeEnqueued(project.id, result.agentType);
		}
		logger.info(`${adapter.type} job queued`, {
			jobId,
			eventType: event.eventType,
		});
	} catch (err) {
		result.onBlocked?.();
		logger.error(`Failed to queue ${adapter.type} job`, {
			error: String(err),
			eventType: event.eventType,
			workItemId: event.workItemId,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Failed to enqueue job to Redis',
		};
	}

	return {
		shouldProcess: true,
		projectId: project.id,
		decisionReason: `Job queued: ${result.agentType} agent for work item ${event.workItemId ?? '(unknown)'}`,
	};
}
