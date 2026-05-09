import { describe, expect, it } from 'vitest';
import {
	ALL_TRIGGER_EVENTS,
	type AlertingTriggerEvent,
	type InternalTriggerEvent,
	type PMTriggerEvent,
	type SCMTriggerEvent,
	TRIGGER_EVENTS,
} from '../../../../src/triggers/shared/events.js';

describe('TRIGGER_EVENTS', () => {
	it('catalogs every current trigger event', () => {
		expect(ALL_TRIGGER_EVENTS).toEqual([
			'pm:status-changed',
			'pm:label-added',
			'pm:comment-mention',
			'scm:check-suite-success',
			'scm:check-suite-failure',
			'scm:pr-review-submitted',
			'scm:review-requested',
			'scm:pr-opened',
			'scm:pr-comment-mention',
			'scm:pr-merged',
			'scm:pr-ready-to-merge',
			'scm:pr-conflict-detected',
			'alerting:issue-alert',
			'alerting:metric-alert',
			'internal:auto-chain',
		]);
	});

	it('keeps event values available as TypeScript literals', () => {
		const pmEvent = TRIGGER_EVENTS.PM.STATUS_CHANGED satisfies 'pm:status-changed';
		const scmEvent = TRIGGER_EVENTS.SCM.PR_OPENED satisfies 'scm:pr-opened';
		const alertingEvent = TRIGGER_EVENTS.ALERTING.ISSUE_ALERT satisfies 'alerting:issue-alert';
		const internalEvent = TRIGGER_EVENTS.INTERNAL.AUTO_CHAIN satisfies 'internal:auto-chain';

		const pmTyped: PMTriggerEvent = pmEvent;
		const scmTyped: SCMTriggerEvent = scmEvent;
		const alertingTyped: AlertingTriggerEvent = alertingEvent;
		const internalTyped: InternalTriggerEvent = internalEvent;

		expect([pmTyped, scmTyped, alertingTyped, internalTyped]).toEqual([
			'pm:status-changed',
			'scm:pr-opened',
			'alerting:issue-alert',
			'internal:auto-chain',
		]);
	});
});
