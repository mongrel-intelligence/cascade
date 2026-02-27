/**
 * Registers TwilioIntegration into the SmsIntegrationRegistry at import time.
 */

import { smsRegistry } from '../registry.js';
import { TwilioIntegration } from './integration.js';

smsRegistry.register(new TwilioIntegration());
