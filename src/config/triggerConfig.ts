import { z } from 'zod';

// ============================================================================
// Email Trigger Config
// ============================================================================

/**
 * Trigger configuration for email-joke agent.
 * Stored in project_integrations.triggers for email category.
 */
export const EmailJokeTriggerConfigSchema = z.object({
	/** Email address filter — only respond to emails from this sender */
	senderEmail: z.string().email().nullable().optional(),
});

export type EmailJokeTriggerConfig = z.infer<typeof EmailJokeTriggerConfigSchema>;

/**
 * Resolve email-joke trigger config with defaults.
 * Also used for type-safe parsing of raw trigger objects.
 */
export function resolveEmailJokeTriggerConfig(
	config: Partial<EmailJokeTriggerConfig> | undefined,
): EmailJokeTriggerConfig {
	return {
		senderEmail: config?.senderEmail ?? undefined,
	};
}

/**
 * Parse and validate email-joke trigger config from unknown input.
 * Returns a properly typed EmailJokeTriggerConfig.
 */
export function parseEmailJokeTriggers(triggers: unknown): EmailJokeTriggerConfig {
	if (!triggers || typeof triggers !== 'object') {
		return { senderEmail: undefined };
	}
	const result = EmailJokeTriggerConfigSchema.safeParse(triggers);
	return result.success ? result.data : { senderEmail: undefined };
}
