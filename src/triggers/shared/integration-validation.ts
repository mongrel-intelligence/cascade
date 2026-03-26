/**
 * Pre-flight integration validation for agents.
 *
 * Validates that all required integrations are configured before an agent runs.
 * Integrations can be explicitly declared in the agent definition, or derived from capabilities.
 */

import { deriveIntegrations } from '../../agents/capabilities/index.js';
import { resolveAgentDefinition } from '../../agents/definitions/loader.js';
import type { IntegrationCategory } from '../../agents/definitions/schema.js';
import { getPersonaForAgentType } from '../../github/personas.js';
import { integrationRegistry } from '../../integrations/registry.js';
import type { SCMIntegration } from '../../integrations/scm.js';
import { logger } from '../../utils/logging.js';

export interface ValidationError {
	category: IntegrationCategory;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

/**
 * Derived integration requirements from agent capabilities.
 */
export interface DerivedIntegrations {
	required: IntegrationCategory[];
	optional: IntegrationCategory[];
}

/**
 * Get integration requirements for an agent.
 *
 * Uses explicit integrations from the definition if available,
 * otherwise falls back to deriving from capabilities.
 */
export async function getIntegrationRequirements(agentType: string): Promise<DerivedIntegrations> {
	const def = await resolveAgentDefinition(agentType);

	// Prefer explicit integrations if defined
	if (def.integrations) {
		return {
			required: def.integrations.required ?? [],
			optional: def.integrations.optional ?? [],
		};
	}

	// Fall back to deriving from capabilities (backward compatibility)
	return deriveIntegrations(def.capabilities.required, def.capabilities.optional);
}

// ============================================================================
// Category-specific validators
// ============================================================================

/**
 * Type guard to check if an integration is an SCMIntegration.
 */
function isScmIntegration(integration: unknown): integration is SCMIntegration {
	return (
		integration !== null &&
		typeof integration === 'object' &&
		(integration as SCMIntegration).category === 'scm' &&
		typeof (integration as SCMIntegration).hasPersonaToken === 'function'
	);
}

/**
 * Build the "not configured" error message for a category.
 */
function notConfiguredError(category: IntegrationCategory, agentType: string): ValidationError {
	const categoryLabels: Partial<Record<IntegrationCategory, string>> = {
		pm: 'a PM integration (Trello/JIRA)',
		scm: 'SCM integration (GitHub)',
		alerting: 'alerting integration (Sentry)',
	};
	const label = categoryLabels[category] ?? `${category} integration`;
	return {
		category,
		message: `Agent '${agentType}' requires ${label}, but none is configured.`,
	};
}

/**
 * Validate SCM persona token for an agent.
 * Returns a ValidationError if the required persona token is missing, or null if valid.
 */
async function validateScmPersonaToken(
	projectId: string,
	agentType: string,
	integrations: ReturnType<typeof integrationRegistry.getByCategory>,
): Promise<ValidationError | null> {
	const scmIntegration = integrations.find(isScmIntegration);
	if (!scmIntegration) return null;

	const persona = getPersonaForAgentType(agentType);
	const hasToken = await scmIntegration.hasPersonaToken(projectId, persona);
	if (!hasToken) {
		const label = persona === 'implementer' ? 'Implementer' : 'Reviewer';
		return {
			category: 'scm',
			message: `Agent '${agentType}' requires ${label} token, but it is not configured.`,
		};
	}
	return null;
}

/**
 * Validate a single integration category for a project.
 * Returns a ValidationError if the category is not properly configured, or null if valid.
 */
async function validateCategory(
	category: IntegrationCategory,
	projectId: string,
	agentType: string,
): Promise<ValidationError | null> {
	const integrations = integrationRegistry.getByCategory(category);

	if (integrations.length === 0) {
		return {
			category,
			message: `Agent '${agentType}' requires ${category} integration, but none is registered.`,
		};
	}

	// Check if at least one integration in this category is configured
	const hasAny = await Promise.all(integrations.map((i) => i.hasIntegration(projectId)));
	if (!hasAny.some(Boolean)) {
		return notConfiguredError(category, agentType);
	}

	// SCM-specific: also check persona token
	if (category === 'scm') {
		return validateScmPersonaToken(projectId, agentType, integrations);
	}

	return null;
}

// ============================================================================
// Main validation function
// ============================================================================

/**
 * Validate all required integrations are configured before agent runs.
 * Integrations are derived from the agent's required capabilities.
 *
 * Uses the integrationRegistry to look up integration modules by category,
 * making validation automatically extensible to new integration categories.
 */
export async function validateIntegrations(
	projectId: string,
	agentType: string,
): Promise<ValidationResult> {
	const { required } = await getIntegrationRequirements(agentType);

	// Run all category validations in parallel
	const validationPromises = required.map((category) =>
		validateCategory(category, projectId, agentType),
	);

	const results = await Promise.all(validationPromises);
	const errors = results.filter((e): e is ValidationError => e !== null);

	if (errors.length > 0) {
		logger.warn('Integration validation failed', {
			projectId,
			agentType,
			errors: errors.map((e) => e.message),
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Format validation errors into user-friendly message.
 */
export function formatValidationErrors(result: ValidationResult): string {
	if (result.valid) return '';
	return [
		'Integration validation failed:',
		...result.errors.map((e) => `  - ${e.message}`),
		'',
		'Configure missing integrations in Project Settings > Integrations.',
	].join('\n');
}
