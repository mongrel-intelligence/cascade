/**
 * Unified integration abstraction layer.
 *
 * Exports:
 * - `IntegrationModule` interface — the category-agnostic contract all integrations implement
 * - `IntegrationWebhookEvent` — normalized webhook event type
 * - `IntegrationRegistry` class — registry for managing integration modules
 * - `integrationRegistry` singleton — the shared registry instance
 */

export type { IntegrationModule, IntegrationWebhookEvent } from './types.js';
export { IntegrationRegistry, integrationRegistry } from './registry.js';
