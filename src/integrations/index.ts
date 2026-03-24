/**
 * Unified integration abstraction layer.
 *
 * Exports:
 * - `IntegrationModule` interface — the category-agnostic contract all integrations implement
 * - `IntegrationWebhookEvent` — normalized webhook event type
 * - `SCMIntegration` interface — SCM-specific extension of IntegrationModule
 * - `AlertingIntegration` interface — alerting-specific extension of IntegrationModule
 * - `IntegrationRegistry` class — registry for managing integration modules
 * - `integrationRegistry` singleton — the shared registry instance
 */

export type { IntegrationModule, IntegrationWebhookEvent } from './types.js';
export type { SCMIntegration } from './scm.js';
export type { AlertingIntegration } from './alerting.js';
export { IntegrationRegistry, integrationRegistry } from './registry.js';
