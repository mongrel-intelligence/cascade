export const TRIGGER_EVENTS = {
	PM: {
		STATUS_CHANGED: 'pm:status-changed',
		LABEL_ADDED: 'pm:label-added',
		COMMENT_MENTION: 'pm:comment-mention',
	},
	SCM: {
		CHECK_SUITE_SUCCESS: 'scm:check-suite-success',
		CHECK_SUITE_FAILURE: 'scm:check-suite-failure',
		PR_REVIEW_SUBMITTED: 'scm:pr-review-submitted',
		REVIEW_REQUESTED: 'scm:review-requested',
		PR_OPENED: 'scm:pr-opened',
		PR_COMMENT_MENTION: 'scm:pr-comment-mention',
		PR_MERGED: 'scm:pr-merged',
		PR_READY_TO_MERGE: 'scm:pr-ready-to-merge',
		PR_CONFLICT_DETECTED: 'scm:pr-conflict-detected',
	},
	ALERTING: {
		ISSUE_ALERT: 'alerting:issue-alert',
		METRIC_ALERT: 'alerting:metric-alert',
	},
	INTERNAL: {
		AUTO_CHAIN: 'internal:auto-chain',
	},
} as const;

type ObjectValues<T> = T[keyof T];

export type PMTriggerEvent = ObjectValues<typeof TRIGGER_EVENTS.PM>;
export type SCMTriggerEvent = ObjectValues<typeof TRIGGER_EVENTS.SCM>;
export type AlertingTriggerEvent = ObjectValues<typeof TRIGGER_EVENTS.ALERTING>;
export type InternalTriggerEvent = ObjectValues<typeof TRIGGER_EVENTS.INTERNAL>;

export type CanonicalTriggerEvent =
	| PMTriggerEvent
	| SCMTriggerEvent
	| AlertingTriggerEvent
	| InternalTriggerEvent;

export const ALL_TRIGGER_EVENTS = [
	...Object.values(TRIGGER_EVENTS.PM),
	...Object.values(TRIGGER_EVENTS.SCM),
	...Object.values(TRIGGER_EVENTS.ALERTING),
	...Object.values(TRIGGER_EVENTS.INTERNAL),
] as CanonicalTriggerEvent[];
