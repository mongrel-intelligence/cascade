/**
 * SMS module barrel.
 *
 * Registers all provider adapters at import time (mirrors email/index.ts).
 * Consumers import from here to get both the public API and side-effect registration.
 */

import './twilio/index.js';

// Provider scoping
export { getSmsProvider, getSmsProviderOrNull, withSmsProvider } from './context.js';

// Integration credential resolution
export { hasSmsIntegration, withSmsIntegration } from './integration.js';

// Registry (for advanced use cases)
export { smsRegistry } from './registry.js';

// Interfaces
export type { SmsIntegration, SmsProvider } from './provider.js';

// Types
export type { SendSmsOptions, SendSmsResult, SmsCredentials } from './types.js';
