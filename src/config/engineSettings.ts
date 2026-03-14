import { z } from 'zod';

export const CodexSettingsSchema = z.object({
	approvalPolicy: z.enum(['never', 'on-request', 'untrusted']).optional(),
	sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
	reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
	webSearch: z.boolean().optional(),
});

export const OpenCodeSettingsSchema = z.object({
	webSearch: z.boolean().optional(),
});

const ENGINE_SETTINGS_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
	codex: CodexSettingsSchema,
	opencode: OpenCodeSettingsSchema,
};

const EngineSettingsValueSchema = z.record(z.string(), z.unknown());

export const EngineSettingsSchema = z
	.record(z.string(), EngineSettingsValueSchema)
	.superRefine((settings, ctx) => {
		for (const [engineId, rawSettings] of Object.entries(settings)) {
			const schema = ENGINE_SETTINGS_SCHEMAS[engineId];
			if (!schema) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [engineId],
					message: `Unsupported engine settings for "${engineId}"`,
				});
				continue;
			}

			const result = schema.safeParse(rawSettings);
			if (!result.success) {
				for (const issue of result.error.issues) {
					ctx.addIssue({
						...issue,
						path: [engineId, ...issue.path],
					});
				}
			}
		}
	})
	.transform((settings) => normalizeEngineSettings(settings) ?? {});

export type CodexSettings = z.infer<typeof CodexSettingsSchema>;
export type OpenCodeSettings = z.infer<typeof OpenCodeSettingsSchema>;
export type EngineSettings = Record<string, Record<string, unknown>>;
type EngineSettingsInput = Record<string, Record<string, unknown> | undefined>;

export function getEngineSettings<T extends z.ZodType<Record<string, unknown>>>(
	settings: EngineSettings | null | undefined,
	engineId: string,
	schema: T,
): z.infer<T> | undefined {
	const rawSettings = settings?.[engineId];
	if (!rawSettings) return undefined;
	return schema.parse(rawSettings);
}

export function normalizeEngineSettings(
	settings?: EngineSettingsInput | null,
): EngineSettings | undefined | null {
	if (settings === null) return null;
	if (!settings) return undefined;

	const entries = Object.entries(settings)
		.map(([engineId, engineSettings]) => {
			if (!engineSettings) return undefined;
			const cleaned = Object.fromEntries(
				Object.entries(engineSettings).filter(([, value]) => value !== undefined),
			);
			return Object.keys(cleaned).length > 0
				? ([engineId, cleaned] as [string, Record<string, unknown>])
				: undefined;
		})
		.filter((entry): entry is [string, Record<string, unknown>] => entry !== undefined);

	const normalized: EngineSettings = Object.fromEntries(entries);

	if (Object.keys(normalized).length === 0) {
		return undefined;
	}

	return normalized;
}

export function mergeEngineSettings(
	defaults?: EngineSettings,
	project?: EngineSettings,
): EngineSettings | undefined {
	const merged: Record<string, Record<string, unknown> | undefined> = Object.fromEntries(
		Array.from(new Set([...Object.keys(defaults ?? {}), ...Object.keys(project ?? {})])).map(
			(engineId) => [
				engineId,
				{
					...(defaults?.[engineId] ?? {}),
					...(project?.[engineId] ?? {}),
				},
			],
		),
	);

	return normalizeEngineSettings(merged) ?? undefined;
}
