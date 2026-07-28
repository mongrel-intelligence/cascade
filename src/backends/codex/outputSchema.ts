export const CODEX_COMPLETION_OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		status: { type: 'string', enum: ['completed', 'failed'] },
		prUrl: { type: ['string', 'null'] },
		summary: { type: 'string' },
	},
	required: ['status', 'prUrl', 'summary'],
} as const;

export interface CodexCompletionReport {
	status: 'completed' | 'failed';
	prUrl: string | null;
	summary: string;
}

/**
 * Parse the schema-conforming last message defensively. Turn failures and
 * corrupted output can still leave a missing or partial file.
 */
export function parseCodexCompletionReport(raw: string): CodexCompletionReport | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

		const report = parsed as Record<string, unknown>;
		if (report.status !== 'completed' && report.status !== 'failed') return undefined;
		if (report.prUrl !== null && typeof report.prUrl !== 'string') return undefined;
		if (typeof report.summary !== 'string') return undefined;

		return {
			status: report.status,
			prUrl: report.prUrl,
			summary: report.summary,
		};
	} catch {
		return undefined;
	}
}
