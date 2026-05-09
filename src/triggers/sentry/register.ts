import type { TriggerRegistry } from '../registry.js';
import { SentryIssueAlertTrigger } from './alerting-issue.js';
import { SentryIssueLifecycleTrigger } from './alerting-issue-lifecycle.js';
import { SentryMetricAlertTrigger } from './alerting-metric.js';

export function registerSentryTriggers(registry: TriggerRegistry): void {
	registry.register(new SentryIssueAlertTrigger());
	registry.register(new SentryMetricAlertTrigger());
	registry.register(new SentryIssueLifecycleTrigger());
}
