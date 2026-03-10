/**
 * Pre-flight integration validation for agents.
 *
 * Validates that all required integrations are configured before an agent runs.
 * Integrations can be explicitly declared in the agent definition, or derived from capabilities.
 */

import { deriveIntegrations } from '../../agents/capabilities/index.js';
import { resolveAgentDefinition } from '../../agents/definitions/loader.js';
import type { IntegrationCategory } from '../../agents/definitions/schema.js';
import { hasEmailIntegration } from '../../email/index.js';
import { hasScmIntegration, hasScmPersonaToken } from '../../github/integration.js';
import { getPersonaForAgentType } from '../../github/personas.js';
import { hasPmIntegration } from '../../pm/integration.js';
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

async function validatePmIntegration(
	projectId: string,
	agentType: string,
): Promise<ValidationError | null> {
	const hasPM = await hasPmIntegration(projectId);
	if (!hasPM) {
		return {
			category: 'pm',
			message: `Agent '${agentType}' requires a PM integration (Trello/JIRA), but none is configured.`,
		};
	}
	return null;
}

async function validateScmIntegration(
	projectId: string,
	agentType: string,
): Promise<ValidationError | null> {
	const hasSCM = await hasScmIntegration(projectId);
	if (!hasSCM) {
		return {
			category: 'scm',
			message: `Agent '${agentType}' requires SCM integration (GitHub), but none is configured.`,
		};
	}

	// Also check specific persona token
	const persona = getPersonaForAgentType(agentType);
	const hasToken = await hasScmPersonaToken(projectId, persona);
	if (!hasToken) {
		const label = persona === 'implementer' ? 'Implementer' : 'Reviewer';
		return {
			category: 'scm',
			message: `Agent '${agentType}' requires ${label} token, but it is not configured.`,
		};
	}

	return null;
}

async function validateEmailIntegration(
	projectId: string,
	agentType: string,
): Promise<ValidationError | null> {
	const hasEmail = await hasEmailIntegration(projectId);
	if (!hasEmail) {
		return {
			category: 'email',
			message: `Agent '${agentType}' requires email integration, but none is configured.`,
		};
	}
	return null;
}

// ============================================================================
// Main validation function
// ============================================================================

/**
 * Validate all required integrations are configured before agent runs.
 * Integrations are derived from the agent's required capabilities.
 */
export async function validateIntegrations(
	projectId: string,
	agentType: string,
): Promise<ValidationResult> {
	const { required } = await getIntegrationRequirements(agentType);

	// Run all validations in parallel
	const validationPromises = required.map(async (category): Promise<ValidationError | null> => {
		switch (category) {
			case 'pm':
				return validatePmIntegration(projectId, agentType);
			case 'scm':
				return validateScmIntegration(projectId, agentType);
			case 'email':
				return validateEmailIntegration(projectId, agentType);
			default:
				return null;
		}
	});

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
