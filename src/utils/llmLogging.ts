import fs from 'node:fs';
import path from 'node:path';

import { type LLMMessage, extractMessageText } from 'llmist';

/**
 * Formats LLM messages as plain text for debugging.
 */
export function formatLlmRequest(messages: LLMMessage[]): string {
	const lines: string[] = [];
	for (const msg of messages) {
		lines.push(`=== ${msg.role.toUpperCase()} ===`);
		// Handle undefined content (for incomplete/malformed messages)
		lines.push(msg.content ? extractMessageText(msg.content) : '');
		lines.push('');
	}
	return lines.join('\n');
}

/**
 * Formats a call number as a zero-padded 4-digit string.
 * E.g., 1 → "0001", 42 → "0042"
 */
export function formatCallNumber(n: number): string {
	return n.toString().padStart(4, '0');
}

/**
 * LLM call logger that writes request/response files to a directory.
 */
export interface LLMCallLogger {
	logDir: string;
	logRequest: (callNumber: number, messages: LLMMessage[]) => void;
	logResponse: (callNumber: number, response: string) => void;
	getLogFiles: () => string[];
}

/**
 * Creates an LLM call logger that writes request/response pairs to a directory.
 */
export function createLLMCallLogger(baseDir: string, prefix: string): LLMCallLogger {
	const timestamp = Date.now();
	const logDir = path.join(baseDir, `${prefix}-llm-calls-${timestamp}`);

	// Create the directory
	fs.mkdirSync(logDir, { recursive: true });

	return {
		logDir,

		logRequest(callNumber: number, messages: LLMMessage[]) {
			const filename = `${formatCallNumber(callNumber)}.request`;
			const content = formatLlmRequest(messages);
			fs.writeFileSync(path.join(logDir, filename), content, 'utf-8');
		},

		logResponse(callNumber: number, response: string) {
			const filename = `${formatCallNumber(callNumber)}.response`;
			fs.writeFileSync(path.join(logDir, filename), response, 'utf-8');
		},

		getLogFiles() {
			try {
				return fs.readdirSync(logDir).map((f) => path.join(logDir, f));
			} catch {
				return [];
			}
		},
	};
}
