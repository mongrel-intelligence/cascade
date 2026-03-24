/**
 * Unified integration bootstrap — canonical registration point for all integrations.
 *
 * Registers all 4 built-in integrations into the `integrationRegistry`:
 *   - TrelloIntegration   (PM)
 *   - JiraIntegration     (PM)
 *   - GitHubSCMIntegration (SCM)
 *   - SentryAlertingIntegration (Alerting)
 *
 * PM integrations are also registered in `pmRegistry` for backward compatibility.
 *
 * Registration is idempotent — importing this module multiple times will not
 * cause duplicate registrations. Uses `getOrNull()` guards before each
 * `register()` call.
 *
 * Safe to import from both the router and worker entry points. Does not pull
 * in the full agent execution pipeline (no processPMWebhook, no template files,
 * no agent execution dependencies).
 *
 * Adding a new integration requires:
 *   1. Implementing IntegrationModule (and optionally PMIntegration / SCMIntegration /
 *      AlertingIntegration) for the new provider.
 *   2. Registering it here.
 */

import { GitHubSCMIntegration } from '../github/scm-integration.js';
import { integrationRegistry } from '../integrations/registry.js';
import { JiraIntegration } from '../pm/jira/integration.js';
import { pmRegistry } from '../pm/registry.js';
import { TrelloIntegration } from '../pm/trello/integration.js';
import { SentryAlertingIntegration } from '../sentry/alerting-integration.js';

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
