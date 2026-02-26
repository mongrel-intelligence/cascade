import { afterEach, describe, expect, it } from 'vitest';
import {
	clearDefinitionCache,
	getKnownAgentTypes,
	loadAgentDefinition,
	loadAllAgentDefinitions,
} from '../../../../src/agents/definitions/loader.js';
import {
	CONTEXT_STEP_REGISTRY,
	GADGET_BUILDER_REGISTRY,
	SDK_TOOLS_REGISTRY,
	TOOL_SET_REGISTRY,
} from '../../../../src/agents/definitions/strategies.js';
import { getAgentCapabilities } from '../../../../src/agents/shared/capabilities.js';

const ALL_AGENT_TYPES = [
	'debug',
	'email-joke',
	'implementation',
	'planning',
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
		it('discovers all 10 agent types from YAML files', () => {
			const types = getKnownAgentTypes();
			expect(types).toEqual(ALL_AGENT_TYPES);
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
		it('returns a map with all 10 agent types', () => {
			const all = loadAllAgentDefinitions();
			expect(all.size).toBe(10);
			for (const agentType of ALL_AGENT_TYPES) {
				expect(all.has(agentType)).toBe(true);
			}
		});
	});

	describe('strategy references resolve correctly', () => {
		it('all tool set references exist in TOOL_SET_REGISTRY', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				for (const setName of def.tools.sets) {
					expect(
						setName === 'all' || setName in TOOL_SET_REGISTRY,
						`${agentType}: tool set '${setName}' not in TOOL_SET_REGISTRY`,
					).toBe(true);
				}
			}
		});

		it('all sdkTools references exist in SDK_TOOLS_REGISTRY', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(
					def.tools.sdkTools in SDK_TOOLS_REGISTRY,
					`${agentType}: sdkTools '${def.tools.sdkTools}' not in SDK_TOOLS_REGISTRY`,
				).toBe(true);
			}
		});

		it('all gadgetBuilder references exist in GADGET_BUILDER_REGISTRY', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(
					def.strategies.gadgetBuilder in GADGET_BUILDER_REGISTRY,
					`${agentType}: gadgetBuilder '${def.strategies.gadgetBuilder}' not in GADGET_BUILDER_REGISTRY`,
				).toBe(true);
			}
		});

		it('all contextPipeline step references exist in CONTEXT_STEP_REGISTRY', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				for (const step of def.strategies.contextPipeline) {
					expect(
						step in CONTEXT_STEP_REGISTRY,
						`${agentType}: contextPipeline step '${step}' not in CONTEXT_STEP_REGISTRY`,
					).toBe(true);
				}
			}
		});

		it('all taskPromptBuilder values correspond to .eta template files', () => {
			const { readdirSync } = require('node:fs');
			const { join, dirname } = require('node:path');
			const { fileURLToPath } = require('node:url');
			const taskTemplatesDir = join(
				dirname(fileURLToPath(import.meta.url)),
				'../../../../src/agents/prompts/task-templates',
			);
			const templateFiles = new Set(
				readdirSync(taskTemplatesDir)
					.filter((f: string) => f.endsWith('.eta'))
					.map((f: string) => f.replace(/\.eta$/, '')),
			);

			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(
					templateFiles.has(def.strategies.taskPromptBuilder),
					`${agentType}: taskPromptBuilder '${def.strategies.taskPromptBuilder}' has no matching .eta template file`,
				).toBe(true);
			}
		});
	});

	describe('definition content spot checks', () => {
		it('implementation has implementation compaction preset', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.compaction).toBe('implementation');
		});

		it('implementation has postConfigure hook', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.backend.postConfigure).toBe('sequentialGadgetExecution');
		});

		it('implementation has requiresPR flag', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.backend.requiresPR).toBe(true);
		});

		it('non-implementation agents do not have requiresPR', () => {
			for (const agentType of ALL_AGENT_TYPES.filter((t) => t !== 'implementation')) {
				const def = loadAgentDefinition(agentType);
				expect(def.backend.requiresPR).toBeUndefined();
			}
		});

		it('work-item agents use standard context pipeline', () => {
			const workItemAgents = ['implementation', 'splitting', 'planning', 'debug'];
			for (const agentType of workItemAgents) {
				const def = loadAgentDefinition(agentType);
				expect(def.strategies.contextPipeline).toEqual([
					'directoryListing',
					'contextFiles',
					'squint',
					'workItem',
				]);
			}
		});

		it('review agent uses PR context pipeline without directoryListing', () => {
			const def = loadAgentDefinition('review');
			expect(def.strategies.contextPipeline).toEqual(['prContext', 'contextFiles', 'squint']);
		});

		it('respond-to-ci uses combined PR + work-item pipeline', () => {
			const def = loadAgentDefinition('respond-to-ci');
			expect(def.strategies.contextPipeline).toEqual([
				'prContext',
				'directoryListing',
				'contextFiles',
				'squint',
				'workItem',
			]);
		});

		it('PR comment agents use conversation pipeline', () => {
			const prCommentAgents = ['respond-to-review', 'respond-to-pr-comment'];
			for (const agentType of prCommentAgents) {
				const def = loadAgentDefinition(agentType);
				expect(def.strategies.contextPipeline).toEqual([
					'prContext',
					'prConversation',
					'directoryListing',
					'contextFiles',
					'squint',
				]);
			}
		});

		it('review has preExecute hook', () => {
			const def = loadAgentDefinition('review');
			expect(def.backend.preExecute).toBe('postInitialPRComment');
		});

		it('respond-to-ci has preExecute hook', () => {
			const def = loadAgentDefinition('respond-to-ci');
			expect(def.backend.preExecute).toBe('postInitialPRComment');
		});

		it('planning is readOnly', () => {
			const def = loadAgentDefinition('planning');
			expect(def.capabilities.isReadOnly).toBe(true);
			expect(def.capabilities.canEditFiles).toBe(false);
			expect(def.tools.sdkTools).toBe('readOnly');
		});

		it('implementation has trailingMessage with all flags', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.trailingMessage).toEqual({
				includeDiagnostics: true,
				includeTodoProgress: true,
				includeGitStatus: true,
				includePRStatus: true,
				includeReminder: true,
			});
		});

		it('respond-to-review has diagnostics-only trailingMessage', () => {
			const def = loadAgentDefinition('respond-to-review');
			expect(def.trailingMessage).toEqual({
				includeDiagnostics: true,
			});
		});

		it('respond-to-ci has diagnostics-only trailingMessage', () => {
			const def = loadAgentDefinition('respond-to-ci');
			expect(def.trailingMessage).toEqual({
				includeDiagnostics: true,
			});
		});

		it('splitting has no trailingMessage', () => {
			const def = loadAgentDefinition('splitting');
			expect(def.trailingMessage).toBeUndefined();
		});

		it('respond-to-review includes review comment gadget options', () => {
			const def = loadAgentDefinition('respond-to-review');
			expect(def.strategies.gadgetBuilderOptions).toEqual({ includeReviewComments: true });
		});

		it('respond-to-pr-comment includes review comment gadget options', () => {
			const def = loadAgentDefinition('respond-to-pr-comment');
			expect(def.strategies.gadgetBuilderOptions).toEqual({ includeReviewComments: true });
		});

		it('debug uses "all" tool set', () => {
			const def = loadAgentDefinition('debug');
			expect(def.tools.sets).toContain('all');
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
	});

	describe('roundtrip: YAML definition → profile properties', () => {
		it('implementation agent has full capabilities and stop hooks', () => {
			const def = loadAgentDefinition('implementation');
			const caps = getAgentCapabilities('implementation');

			expect(caps.canEditFiles).toBe(true);
			expect(caps.canCreatePR).toBe(true);
			expect(caps.canUpdateChecklists).toBe(true);
			expect(caps.isReadOnly).toBe(false);
			expect(def.backend.enableStopHooks).toBe(true);
			expect(def.backend.needsGitHubToken).toBe(true);
			expect(def.backend.preExecute).toBeUndefined();
			expect(def.backend.postConfigure).toBe('sequentialGadgetExecution');
			expect(SDK_TOOLS_REGISTRY[def.tools.sdkTools]).toBeDefined();
		});

		it('review agent is read-only with preExecute hook', () => {
			const def = loadAgentDefinition('review');
			const caps = getAgentCapabilities('review');

			expect(caps.canEditFiles).toBe(false);
			expect(caps.isReadOnly).toBe(true);
			expect(def.backend.enableStopHooks).toBe(false);
			expect(def.backend.needsGitHubToken).toBe(true);
			expect(def.backend.preExecute).toBe('postInitialPRComment');
		});

		it('respond-to-ci agent has preExecute and needsGitHubToken', () => {
			const def = loadAgentDefinition('respond-to-ci');
			const caps = getAgentCapabilities('respond-to-ci');

			expect(caps.canEditFiles).toBe(true);
			expect(def.backend.needsGitHubToken).toBe(true);
			expect(def.backend.preExecute).toBe('postInitialPRComment');
		});

		it('all agent sdkTools references resolve to non-empty arrays', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				const sdkTools = SDK_TOOLS_REGISTRY[def.tools.sdkTools];
				expect(
					Array.isArray(sdkTools) && sdkTools.length > 0,
					`${agentType}: sdkTools '${def.tools.sdkTools}' resolved to empty or non-array`,
				).toBe(true);
			}
		});

		it('capabilities from getAgentCapabilities match YAML definition for all agents', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				const caps = getAgentCapabilities(agentType);

				expect(caps.canEditFiles).toBe(def.capabilities.canEditFiles);
				expect(caps.canCreatePR).toBe(def.capabilities.canCreatePR);
				expect(caps.canUpdateChecklists).toBe(def.capabilities.canUpdateChecklists);
				expect(caps.isReadOnly).toBe(def.capabilities.isReadOnly);
			}
		});
	});

	describe('unknown agent type fallbacks', () => {
		it('getAgentCapabilities returns full-access defaults for unknown type', () => {
			const caps = getAgentCapabilities('nonexistent-agent-type');
			expect(caps).toEqual({
				canEditFiles: true,
				canCreatePR: true,
				canUpdateChecklists: true,
				isReadOnly: false,
			});
		});
	});

	describe('integration requirements', () => {
		it('all agents have integrations field with required and optional arrays', () => {
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				expect(def.integrations).toBeDefined();
				expect(Array.isArray(def.integrations.required)).toBe(true);
				expect(Array.isArray(def.integrations.optional)).toBe(true);
			}
		});

		it('implementation agent requires scm and pm', () => {
			const def = loadAgentDefinition('implementation');
			expect(def.integrations.required).toEqual(['scm', 'pm']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('splitting agent requires scm and pm', () => {
			const def = loadAgentDefinition('splitting');
			expect(def.integrations.required).toEqual(['scm', 'pm']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('planning agent requires scm and pm', () => {
			const def = loadAgentDefinition('planning');
			expect(def.integrations.required).toEqual(['scm', 'pm']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('review agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('review');
			expect(def.integrations.required).toEqual(['scm']);
			expect(def.integrations.optional).toEqual(['pm']);
		});

		it('respond-to-review agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-review');
			expect(def.integrations.required).toEqual(['scm']);
			expect(def.integrations.optional).toEqual(['pm']);
		});

		it('respond-to-ci agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-ci');
			expect(def.integrations.required).toEqual(['scm']);
			expect(def.integrations.optional).toEqual(['pm']);
		});

		it('respond-to-pr-comment agent requires scm, pm is optional', () => {
			const def = loadAgentDefinition('respond-to-pr-comment');
			expect(def.integrations.required).toEqual(['scm']);
			expect(def.integrations.optional).toEqual(['pm']);
		});

		it('respond-to-planning-comment agent requires scm and pm', () => {
			const def = loadAgentDefinition('respond-to-planning-comment');
			expect(def.integrations.required).toEqual(['scm', 'pm']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('debug agent requires pm only', () => {
			const def = loadAgentDefinition('debug');
			expect(def.integrations.required).toEqual(['pm']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('email-joke agent requires email only', () => {
			const def = loadAgentDefinition('email-joke');
			expect(def.integrations.required).toEqual(['email']);
			expect(def.integrations.optional).toEqual([]);
		});

		it('all integration categories are valid', () => {
			const validCategories = ['pm', 'scm', 'email'];
			for (const agentType of ALL_AGENT_TYPES) {
				const def = loadAgentDefinition(agentType);
				for (const cat of def.integrations.required) {
					expect(
						validCategories.includes(cat),
						`${agentType}: invalid required category '${cat}'`,
					).toBe(true);
				}
				for (const cat of def.integrations.optional) {
					expect(
						validCategories.includes(cat),
						`${agentType}: invalid optional category '${cat}'`,
					).toBe(true);
				}
			}
		});
	});
});
