/**
 * Shared escalation hint utilities for file-editing gadgets.
 *
 * Extracted from FileSearchAndReplace and FileMultiEdit to eliminate
 * byte-for-byte duplication of the ESCALATION_HINT constant and the
 * withEscalationHint function.
 */

import { recordEditFailure } from './diagnosticState.js';

export const ESCALATION_HINT =
	'\n\nTIP: This file has failed multiple edit attempts. For files with repetitive structure ' +
	'(CRUD methods, similar function signatures), use ReadFile to get the current content, ' +
	'then WriteFile to rewrite the entire file or section.';

export function withEscalationHint(message: string, filePath: string): string {
	const failCount = recordEditFailure(filePath);
	return failCount >= 2 ? message + ESCALATION_HINT : message;
}
