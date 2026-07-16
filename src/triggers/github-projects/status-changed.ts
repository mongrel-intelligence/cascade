/**
 * GitHub Projects status-changed trigger.
 *
 * Fires when a GitHub Projects v2 item's Status field is changed to a
 * configured option that maps to a CASCADE agent type.
 *
 * IMPORTANT — webhook payload shape. GitHub's `projects_v2_item.edited`
 * webhook reliably carries only `changes.field_value.field_node_id` and
 * `field_type`; it does NOT dependably deliver the changed field's name or its
 * new/old values (`field_name` / `from` / `to`). We therefore treat those as
 * optional hints and read the item's *current* Status option ID from the
 * GraphQL API (authoritative). This trigger runs on the router inside
 * `withGitHubProjectsCredentials` scope, so the live read is safe here.
 */

import { getProjectItem } from '../../github-projects/client.js';
import { getGitHubProjectsConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { TRIGGER_EVENTS } from '../shared/events.js';
import { shouldBlockForPipelineCapacity } from '../shared/pipeline-capacity-gate.js';
import {
	buildPMStatusDispatchResult,
	resolvePMStatusAgentByIdFromWorkflowDefinitions,
	shouldFirePMStatusEvent,
} from '../shared/pm-status.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';

interface GitHubProjectsWebhookPayload {
	action: 'edited' | 'created';
	projects_v2_item: {
		node_id: string;
		project_node_id: string;
		content_node_id: string;
		content_type: 'Issue' | 'PullRequest';
	};
	changes?: {
		field_value?: {
			field_node_id: string;
			field_name?: string;
			from?: { id: string; name: string } | null;
			to?: { id: string; name: string } | null;
		};
	};
}

export class GitHubProjectsStatusChangedTrigger implements TriggerHandler {
	name = 'github-projects-status-changed';
	description = 'Triggers agent when a GitHub Projects item moves to a configured status';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github-projects') return false;

		const payload = ctx.payload as GitHubProjectsWebhookPayload;
		if (!payload.projects_v2_item) return false;

		// Only field-value edits can be status changes. Creation events do not
		// carry a status change in the same payload.
		if (payload.action !== 'edited') return false;
		const fieldValue = payload.changes?.field_value;
		if (!fieldValue) return false;

		// Fast-path filter: if GitHub told us the field name, require Status.
		// When absent (the common case), defer the Status determination to
		// handle(), which confirms it against the live field ID.
		if (fieldValue.field_name && fieldValue.field_name !== 'Status') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubProjectsWebhookPayload;
		const item = payload.projects_v2_item;
		const fieldValue = payload.changes?.field_value;

		const config = getGitHubProjectsConfig(ctx.project);
		if (!config?.statuses) {
			logger.debug('No GitHub Projects status configuration, skipping status-changed trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Authoritative read: fetch the item's current Status option ID. The
		// webhook's `to.id` (when present) may be a value-node ID rather than the
		// option ID persisted in config, so we always resolve from the API.
		const projectItem = await getProjectItem(item.node_id);
		const statusValue = projectItem.fieldValues?.nodes.find((n) => n.field?.name === 'Status');
		if (!statusValue) {
			logger.debug('GitHub Projects item has no Status field value, skipping', {
				itemId: item.node_id,
			});
			return null;
		}

		// Confirm the change actually touched the Status field, to avoid
		// re-dispatching when an unrelated field (Priority, etc.) changed while
		// the item merely sits in a mapped status.
		const changedFieldId = fieldValue?.field_node_id;
		const fieldNameHint = fieldValue?.field_name;
		const isStatusChange = changedFieldId
			? changedFieldId === statusValue.field.id
			: fieldNameHint === 'Status';
		if (!isStatusChange) {
			logger.debug('GitHub Projects edit did not touch the Status field, skipping', {
				itemId: item.node_id,
				changedFieldId,
				statusFieldId: statusValue.field.id,
			});
			return null;
		}

		const newStatusId = statusValue.optionId;
		if (!newStatusId) {
			return null;
		}

		const resolved = await resolvePMStatusAgentByIdFromWorkflowDefinitions({
			statusId: newStatusId,
			configuredStatuses: config.statuses,
		});
		if (!resolved) {
			logger.debug('GitHub Projects status transition does not map to any agent', {
				itemId: item.node_id,
				newStatusId,
				configuredStatuses: config.statuses,
			});
			return null;
		}
		const { agentType, cascadeStatus: matchedCascadeStatus } = resolved;

		const { enabled, parameters } = await checkTriggerEnabledWithParams(
			ctx.project.id,
			agentType,
			TRIGGER_EVENTS.PM.STATUS_CHANGED,
			this.name,
		);
		if (!enabled) return null;

		if (!shouldFirePMStatusEvent(false, parameters)) {
			logger.debug('GitHub Projects status-changed event gated by trigger params', {
				itemId: item.node_id,
				agentType,
				parameters,
			});
			return null;
		}

		if (
			await shouldBlockForPipelineCapacity({
				project: ctx.project,
				agentType,
				workItemId: item.content_node_id,
				source: 'github-projects',
			})
		) {
			return null;
		}

		logger.info('GitHub Projects item entered agent-triggering status', {
			itemId: item.node_id,
			newStatusId,
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		return buildPMStatusDispatchResult({
			projectId: ctx.project.id,
			agentType,
			workItemId: item.content_node_id,
			agentInput: {
				githubProjectsItemId: item.node_id,
			},
		});
	}
}
