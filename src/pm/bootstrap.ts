/**
 * PM integration bootstrap — safe to import from the router.
 *
 * Registers all built-in PM integrations into the pmRegistry without
 * pulling in the full agent execution pipeline (no processPMWebhook,
 * no template files, no agent execution dependencies).
 *
 * Import this module from the router entry point to ensure PM integrations
 * are available before any platform adapters are called. Each integration
 * class is standalone (HTTP-based, no agent pipeline dependencies).
 *
 * Adding a new PM integration requires:
 *   1. Implementing PMIntegration in `pm/<provider>/integration.ts`
 *   2. Registering it here.
 */

import { JiraIntegration } from './jira/integration.js';
import { pmRegistry } from './registry.js';
import { TrelloIntegration } from './trello/integration.js';

if (!pmRegistry.getOrNull('trello')) pmRegistry.register(new TrelloIntegration());
if (!pmRegistry.getOrNull('jira')) pmRegistry.register(new JiraIntegration());
