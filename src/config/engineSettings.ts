import { z } from 'zod';

/**
 * Dynamic registry of engine settings schemas.
 * Engines register their schema during bootstrap via registerEngineSettingsSchema().
 *
 * Schemas are registered exclusively through registerBuiltInEngines() (called from
 * bootstrap.ts) — there are no static pre-registration imports here. All entry
 * points (router, worker, dashboard) must call registerBuiltInEngines() before any
 * config parsing that uses EngineSettingsSchema.
 */
const ENGINE_SETTINGS_SCHEMAS: Map<string, z.ZodType<Record<string, unknown>>> = new Map();

/**
 * Register a settings schema for an engine. Called during bootstrap when an engine
 * implementing getSettingsSchema() is registered.
 */
export function registerEngineSettingsSchema(
	engineId: string,
	schema: z.ZodType<Record<string, unknown>>,
): void {
	ENGINE_SETTINGS_SCHEMAS.set(engineId, schema);
}

/**
 * Retrieve the registered settings schema for an engine, if any.
 */
export function getEngineSettingsSchema(
	engineId: string,
): z.ZodType<Record<string, unknown>> | undefined {
	return ENGINE_SETTINGS_SCHEMAS.get(engineId);
}

const EngineSettingsValueSchema = z.record(z.string(), z.unknown());

export const EngineSettingsSchema = z
	.record(z.string(), EngineSettingsValueSchema)
	.superRefine((settings, ctx) => {
		for (const [engineId, rawSettings] of Object.entries(settings)) {
			const schema = ENGINE_SETTINGS_SCHEMAS.get(engineId);
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
