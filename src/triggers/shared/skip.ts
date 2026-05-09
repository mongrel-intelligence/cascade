import type { TriggerResult } from '../../types/index.js';
import { buildSkipResult } from './result-builders.js';

/**
 * Build a structured self-skip result so the router's webhook log
 * decisionReason surfaces the real reason a matched handler bailed (instead
 * of the generic `'No trigger matched for event'` placeholder). The shape is
 * defined by `TriggerResult.skipReason`; the webhook-processor at
 * `src/router/webhook-processor.ts` promotes `skipReason.message` into the
 * persisted webhook log when `agentType === null`.
 *
 * Single canonical source — replaces the duplicate `skip()` helpers that
 * lived inside individual trigger files. Adding a new self-skip site means
 * `import { skip } from '../shared/skip.js'` and one call.
 */
export function skip(handler: string, message: string): TriggerResult {
	return buildSkipResult(handler, message);
}
