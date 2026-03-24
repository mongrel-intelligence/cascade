/**
 * Tool definitions for alerting tools.
 *
 * Single source of truth for both CLI commands and llmist gadgets.
 * Named generically so adding a second alerting provider requires no renames.
 */

import type { ToolDefinition } from '../shared/toolDefinition.js';

export const getAlertingIssueDef: ToolDefinition = {
	name: 'GetAlertingIssue',
	description:
		'Retrieve metadata for an alerting issue: title, culprit, status, occurrence count, firstSeen, lastSeen, and permalink. Use this to get an overview before diving into event details.',
	timeoutMs: 15000,
	parameters: {
		organizationId: {
			type: 'string',
			describe: 'The organization identifier (e.g. "my-company")',
			required: true,
		},
		issueId: {
			type: 'string',
			describe: 'The issue ID',
			required: true,
		},
	},
	examples: [
		{
			params: { organizationId: 'acme', issueId: '123456' },
			comment: 'Get metadata for issue 123456 in the acme organization',
		},
	],
};

export const getAlertingEventDetailDef: ToolDefinition = {
	name: 'GetAlertingEventDetail',
	description:
		'Retrieve full details for an alerting event: exception type/value, complete stacktrace with source context (5 lines before/after each frame), breadcrumbs, tags, environment, release, and request context. Use this to understand exactly what happened and where in the code.',
	timeoutMs: 15000,
	parameters: {
		organizationId: {
			type: 'string',
			describe: 'The organization identifier (e.g. "my-company")',
			required: true,
		},
		issueId: {
			type: 'string',
			describe: 'The issue ID',
			required: true,
		},
		eventId: {
			type: 'string',
			describe:
				'The event ID to retrieve. Use "latest" (default), "oldest", or "recommended" for convenience, or a specific event ID.',
			optional: true,
			default: 'latest',
		},
	},
	examples: [
		{
			params: { organizationId: 'acme', issueId: '123456', eventId: 'latest' },
			comment: 'Get the latest event with full stacktrace for issue 123456',
		},
		{
			params: { organizationId: 'acme', issueId: '123456', eventId: 'abc123def456' },
			comment: 'Get a specific event by ID',
		},
	],
};

export const listAlertingEventsDef: ToolDefinition = {
	name: 'ListAlertingEvents',
	description:
		'List recent events for an alerting issue. Returns timestamps, event IDs, and transaction names. Useful for understanding how often the issue occurs and whether it is recent.',
	timeoutMs: 15000,
	parameters: {
		organizationId: {
			type: 'string',
			describe: 'The organization identifier (e.g. "my-company")',
			required: true,
		},
		issueId: {
			type: 'string',
			describe: 'The issue ID',
			required: true,
		},
		limit: {
			type: 'number',
			describe: 'Maximum number of events to return (default: 5)',
			optional: true,
			default: 5,
		},
	},
	examples: [
		{
			params: { organizationId: 'acme', issueId: '123456', limit: 5 },
			comment: 'List the 5 most recent events for issue 123456',
		},
	],
};
