import { afterEach, describe, expect, it } from 'vitest';
import {
	deriveIntegrations,
	getSdkToolsFromCapabilities,
} from '../../../../src/agents/capabilities/resolver.js';
import {
	clearDefinitionCache,
	getKnownAgentTypes,
	isBuiltinAgentType,
	loadAgentDefinition,
	loadAllAgentDefinitions,
} from '../../../../src/agents/definitions/loader.js';
import { CONTEXT_STEP_REGISTRY } from '../../../../src/agents/definitions/strategies.js';
import { getAgentCapabilities } from '../../../../src/agents/shared/capabilities.js';

const ALL_AGENT_TYPES = [
	'backlog-manager',
	'debug',
	'implementation',
	'planning',
	'resolve-conflicts',
	'respond-to-ci',
	'respond-to-planning-comment',
	'respond-to-pr-comment',
	'respond-to-review',
	'review',
	'splitting',
];

describe('YAML agent definitions loader', () => {
	afterEach(() => {
		clearDefinitionCache();
	});

	describe('getKnownAgentTypes', () => {
		it('discovers all 11 agent types from YAML files', () => {
			const types = getKnownAgentTypes();
			expect(types).toEqual(ALL_AGENT_TYPES);
		});
	});

	describe('isBuiltinAgentType', () => {
		it('returns true for known YAML-backed agent types', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				expect(isBuiltinAgentType(agentType)).toBe(true);
			}
		});

		it('returns false for unknown agent types', () => {
			expect(isBuiltinAgentType('nonexistent-agent')).toBe(false);
			expect(isBuiltinAgentType('custom-agent')).toBe(false);
		});
	});

	describe('loadAgentDefinition', () => {
		it('loads and parses each agent definition without error', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				expect(() => loadAgentDefinition(agentType)).not.toThrow();
			}
		});

		it('throws for unknown agent type', () => {
			expect(() => loadAgentDefinition('nonexistent-agent')).toThrow('Agent definition not found');
		});

		it('caches parsed definitions', () => {
			const first = loadAgentDefinition('implementation');
			const second = loadAgentDefinition('implementation');
			expect(first).toBe(second);
		});

		it('returns fresh results after cache clear', () => {
			const first = loadAgentDefinition('implementation');
			clearDefinitionCache();
			const second = loadAgentDefinition('implementation');
			expect(first).not.toBe(second);
			expect(first).toEqual(second);
		});
	});

	describe('loadAllAgentDefinitions', () => {
		it('returns a map with all 11 agent types', () => {
			const all = loadAllAgentDefinitions();
			expect(all.size).toBe(ALL_AGENT_TYPES.length);
			for (const agentType of ALL_AGENT_TYPES) {
				expect(all.has(agentType)).toBe(true);
			}
		});
	});

	describe('strategy references resolve correctly', () => {
		it('all agents have valid capabilities', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(Array.isArray(def.capabilities.required)).toBe(true);
				expect(Array.isArray(def.capabilities.optional)).toBe(true);
				expect(def.capabilities.required.length).toBeGreaterThan(0);
			}
		});

		it('agents with fs or shell capabilities derive to non-empty SDK tools', () => {
			// Only agents with fs:* or shell:exec capabilities need SDK tools.
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				const allCaps = [...def.capabilities.required, ...def.capabilities.optional];

				// Check if agent has any capabilities that provide SDK tools
				const hasSdkCapabilities = allCaps.some(
					(cap) => cap.startsWith('fs:') || cap === 'shell:exec',
				);

				if (hasSdkCapabilities) {
					const sdkTools = getSdkToolsFromCapabilities(allCaps);
					expect(
						sdkTools.length > 0,
						`${agentType}: has SDK-capable capabilities but no SDK tools`,
					).toBe(true);
				}
			}
		});

		it('all trigger contextPipeline step references exist in CONTEXT_STEP_REGISTRY', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				for (const trigger of def.triggers ?? []) {
					for (const step of trigger.contextPipeline ?? []) {
						expect(
							step in CONTEXT_STEP_REGISTRY,
							`${agentType}/${trigger.event}: contextPipeline step '${step}' not in CONTEXT_STEP_REGISTRY`,
						).toBe(true);
					}
				}
			}
		});

		it('all agents have prompts.taskPrompt defined', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(
					typeof def.prompts?.taskPrompt === 'string' && def.prompts.taskPrompt.length > 0,
					`${agentType}: prompts.taskPrompt is missing or empty`,
				).toBe(true);
			}
		});
	});

	describe('definition content spot checks', () => {
		it('implementation has requiresPR flag in hooks.finish.scm', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.hooks?.finish?.scm?.requiresPR).toBe(true);
		});

		it('non-implementation agents do not have hooks.finish.scm.requiresPR', () => {
			for (const agentType of ALL_AGENT_TYPES.filter((t) => t !== 'implementation')) {
				const def = loadAgentDefinition(agentType);
				expect(def.hooks?.finish?.scm?.requiresPR).toBeUndefined();
			}
		});

		it('work-item agents have triggers with standard context pipeline', () => {
			// implementation, splitting, planning triggers include workItem context
			const def = loadAgentDefinition('implementation');
			const statusChangedTrigger = def.triggers.find((t) => t.event === 'pm:status-changed');
			expect(statusChangedTrigger?.contextPipeline).toEqual([
				'directoryListing',
				'contextFiles',
				'squint',
				'workItem',
				'prepopulateTodos',
			]);
		});

		it('review agent triggers use PR context pipeline', () => {
			const def = loadAgentDefinition('review');
			const ciPassedTrigger = def.triggers.find((t) => t.event === 'scm:check-suite-success');
			expect(ciPassedTrigger?.contextPipeline).toEqual(['prContext', 'contextFiles', 'squint']);
		});

		it('respond-to-ci trigger uses combined PR + work-item pipeline', () => {
			const def = loadAgentDefinition('respond-to-ci');
			const ciFailureTrigger = def.triggers.find((t) => t.event === 'scm:check-suite-failure');
			expect(ciFailureTrigger?.contextPipeline).toEqual([
				'prContext',
				'directoryListing',
				'contextFiles',
				'squint',
				'workItem',
			]);
		});

		it('PR comment agents have triggers with conversation pipeline', () => {
			const def = loadAgentDefinition('respond-to-pr-comment');
			const prCommentTrigger = def.triggers.find((t) => t.event === 'scm:pr-comment-mention');
			expect(prCommentTrigger?.contextPipeline).toEqual([
				'prContext',
				'prConversation',
				'directoryListing',
				'contextFiles',
				'squint',
			]);
		});

		it('planning has read-only capabilities (no fs:write)', () => {
			const def = loadAgentDefinition('planning');
			expect(def.capabilities.required).toContain('fs:read');
			expect(def.capabilities.required).not.toContain('fs:write');
		});

		it('implementation has trailing hooks with all flags', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.hooks?.trailing).toEqual({
				scm: { gitStatus: true, prStatus: true },
				builtin: { diagnostics: true, todoProgress: true, reminder: true },
			});
		});

		it('respond-to-review has diagnostics-only trailing hooks', () => {
			const def = loadAgentDefinition('respond-to-review');
			expect(def.hooks?.trailing).toEqual({
				builtin: { diagnostics: true },
			});
		});

		it('respond-to-ci has diagnostics-only trailing hooks', () => {
			const def = loadAgentDefinition('respond-to-ci');
			expect(def.hooks?.trailing).toEqual({
				builtin: { diagnostics: true },
			});
		});

		it('splitting has no hooks', () => {
			const def = loadAgentDefinition('splitting');
			expect(def.hooks).toBeUndefined();
		});

		it('respond-to-review includes review comment gadget options', () => {
			const def = loadAgentDefinition('respond-to-review');
			expect(def.strategies.gadgetOptions).toEqual({ includeReviewComments: true });
		});

		it('respond-to-pr-comment includes review comment gadget options', () => {
			const def = loadAgentDefinition('respond-to-pr-comment');
			expect(def.strategies.gadgetOptions).toEqual({ includeReviewComments: true });
		});

		it('all agents have non-empty identity fields', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(def.identity.emoji.length).toBeGreaterThan(0);
				expect(def.identity.label.length).toBeGreaterThan(0);
				expect(def.identity.roleHint.length).toBeGreaterThan(0);
				expect(def.identity.initialMessage.length).toBeGreaterThan(0);
			}
		});

		it('all agents have non-empty hints', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(def.hint.length).toBeGreaterThan(0);
			}
		});

		it('backlog-manager has pm:status-changed, scm:pr-merged, and internal:auto-chain triggers', () => {
			const def = loadAgentDefinition('backlog-manager');
			const statusChangedTrigger = def.triggers.find((t) => t.event === 'pm:status-changed');
			const prMergedTrigger = def.triggers.find((t) => t.event === 'scm:pr-merged');
			const autoChainTrigger = def.triggers.find((t) => t.event === 'internal:auto-chain');
			expect(statusChangedTrigger).toBeDefined();
			expect(prMergedTrigger).toBeDefined();
			expect(autoChainTrigger).toBeDefined();
		});

		it('backlog-manager integration triggers are defaultEnabled: false (opt-in)', () => {
			const def = loadAgentDefinition('backlog-manager');
			const integrationTriggers = def.triggers.filter((t) => !t.event.startsWith('internal:'));
			for (const trigger of integrationTriggers) {
				expect(trigger.defaultEnabled).toBe(false);
			}
		});

		it('backlog-manager internal:auto-chain trigger is defaultEnabled: true', () => {
			const def = loadAgentDefinition('backlog-manager');
			const autoChainTrigger = def.triggers.find((t) => t.event === 'internal:auto-chain');
			expect(autoChainTrigger?.defaultEnabled).toBe(true);
		});

		it('backlog-manager requires only pm integration', () => {
			const def = loadAgentDefinition('backlog-manager');
			expect(def.integrations?.required).toContain('pm');
			expect(def.integrations?.optional ?? []).not.toContain('scm');
		});
	});

	describe('roundtrip: YAML definition → profile properties', () => {
		it('implementation agent has full capabilities and stop hooks', async () => {
			const def = loadAgentDefinition('implementation');
			const caps = await getAgentCapabilities('implementation');

			expect(caps.canEditFiles).toBe(true);
			expect(caps.canCreatePR).toBe(true);
			expect(caps.canUpdateChecklists).toBe(true);
			expect(caps.isReadOnly).toBe(false);
			expect(def.hooks?.finish?.scm?.requiresPR).toBe(true);
			expect(def.integrations?.required).toContain('scm');
		});

		it('review agent is read-only', async () => {
			const def = loadAgentDefinition('review');
			const caps = await getAgentCapabilities('review');

			expect(caps.canEditFiles).toBe(false);
			expect(caps.isReadOnly).toBe(true);
			expect(def.hooks?.finish?.scm?.requiresReview).toBe(true);
			expect(def.integrations?.required).toContain('scm');
		});

		it('respond-to-ci agent requires scm integration', async () => {
			const def = loadAgentDefinition('respond-to-ci');
			const caps = await getAgentCapabilities('respond-to-ci');

			expect(caps.canEditFiles).toBe(true);
			expect(def.integrations?.required).toContain('scm');
		});

		it('capabilities from getAgentCapabilities are derived correctly for all agents', async () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				const caps = await getAgentCapabilities(agentType);
				const allCaps = [...def.capabilities.required, ...def.capabilities.optional];

				// canEditFiles = has fs:write
				expect(caps.canEditFiles).toBe(allCaps.includes('fs:write'));

				// canCreatePR = has scm:pr
				expect(caps.canCreatePR).toBe(allCaps.includes('scm:pr'));

				// canUpdateChecklists = has pm:checklist
				expect(caps.canUpdateChecklists).toBe(allCaps.includes('pm:checklist'));

				// isReadOnly = no fs:write
				expect(caps.isReadOnly).toBe(!allCaps.includes('fs:write'));
			}
		});
	});

	describe('unknown agent type fallbacks', () => {
		it('getAgentCapabilities returns full-access defaults for unknown type', async () => {
			const caps = await getAgentCapabilities('nonexistent-agent-type');
			expect(caps).toEqual({
				canEditFiles: true,
				canCreatePR: true,
				canUpdateChecklists: true,
				isReadOnly: false,
			});
		});
	});

	describe('integration requirements (derived from capabilities)', () => {
		it('all agents have valid capabilities with required array', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(Array.isArray(def.capabilities.required)).toBe(true);
				expect(Array.isArray(def.capabilities.optional)).toBe(true);
			}
		});

		it('implementation agent requires scm and pm (derived from capabilities)', () => {
			const def = loadAgentDefinition('implementation');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			// Order may vary - use set comparison
			expect(new Set(integrations.required)).toEqual(new Set(['scm', 'pm']));
			expect(integrations.optional).toEqual([]);
		});

		it('splitting agent requires pm only', () => {
			const def = loadAgentDefinition('splitting');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['pm']);
			expect(integrations.optional).toEqual([]);
		});

		it('planning agent requires pm only', () => {
			const def = loadAgentDefinition('planning');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['pm']);
			expect(integrations.optional).toEqual([]);
		});

		it('review agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('review');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['scm']);
			expect(integrations.optional).toEqual(['pm']);
		});

		it('respond-to-review agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-review');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['scm']);
			expect(integrations.optional).toEqual(['pm']);
		});

		it('respond-to-ci agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-ci');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['scm']);
			expect(integrations.optional).toEqual(['pm']);
		});

		it('respond-to-pr-comment agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-pr-comment');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['scm']);
			expect(integrations.optional).toEqual(['pm']);
		});

		it('respond-to-planning-comment agent requires pm only', () => {
			const def = loadAgentDefinition('respond-to-planning-comment');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['pm']);
			expect(integrations.optional).toEqual([]);
		});

		it('debug agent requires pm only', () => {
			const def = loadAgentDefinition('debug');
			const integrations = deriveIntegrations(def.capabilities.required, def.capabilities.optional);
			expect(integrations.required).toEqual(['pm']);
			expect(integrations.optional).toEqual([]);
		});

		it('all derived integration categories are valid', () => {
			const validCategories = ['pm', 'scm', 'email'];
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				const integrations = deriveIntegrations(
					def.capabilities.required,
					def.capabilities.optional,
				);
				for (const cat of integrations.required) {
					expect(
						validCategories.includes(cat),
						`${agentType}: invalid required category '${cat}'`,
					).toBe(true);
				}
				for (const cat of integrations.optional) {
					expect(
						validCategories.includes(cat),
						`${agentType}: invalid optional category '${cat}'`,
					).toBe(true);
				}
			}
		});
	});
});
