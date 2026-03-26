/**
 * Integration bootstrap — safe to import from the router.
 *
 * Registers all built-in integrations (PM and SCM) into their respective
 * registries without pulling in the full agent execution pipeline (no
 * processPMWebhook, no template files, no agent execution dependencies).
 *
 * Import this module from the router entry point to ensure integrations
 * are available before any platform adapters are called. Each integration
 * class is standalone (HTTP-based, no agent pipeline dependencies).
 *
 * Adding a new PM integration requires:
 *   1. Implementing PMIntegration in `pm/<provider>/integration.ts`
 *   2. Registering it here.
 *
 * Adding a new SCM integration requires:
 *   1. Implementing SCMIntegration in `github/scm-integration.ts` (or similar)
 *   2. Registering it here.
 */

import { GitHubSCMIntegration } from '../github/scm-integration.js';
import { integrationRegistry } from '../integrations/registry.js';
import { SentryAlertingIntegration } from '../sentry/alerting-integration.js';
import { JiraIntegration } from './jira/integration.js';
import { pmRegistry } from './registry.js';
import { TrelloIntegration } from './trello/integration.js';

if (!pmRegistry.getOrNull('trello')) {
	const trello = new TrelloIntegration();
	pmRegistry.register(trello);
	if (!integrationRegistry.getOrNull('trello')) integrationRegistry.register(trello);
}
if (!pmRegistry.getOrNull('jira')) {
	const jira = new JiraIntegration();
	pmRegistry.register(jira);
	if (!integrationRegistry.getOrNull('jira')) integrationRegistry.register(jira);
}
if (!integrationRegistry.getOrNull('github')) {
	integrationRegistry.register(new GitHubSCMIntegration());
}
if (!integrationRegistry.getOrNull('sentry')) {
	integrationRegistry.register(new SentryAlertingIntegration());
}
