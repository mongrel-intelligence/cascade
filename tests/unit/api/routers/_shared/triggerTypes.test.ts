import { describe, expect, it } from 'vitest';
import { CONTEXT_STEP_NAMES } from '../../../../../src/agents/definitions/schema.js';
import {
	type KnownTriggerEvent,
	type ProjectTriggersView,
	type ResolvedTrigger,
	TRIGGER_CATEGORY_LABELS,
	TRIGGER_REGISTRY,
	type TriggerCategory,
	type TriggerParameterDef,
	type TriggerParameterValue,
} from '../../../../../src/api/routers/_shared/triggerTypes.js';

describe('triggerTypes', () => {
	describe('TRIGGER_CATEGORY_LABELS', () => {
		it('has labels for all categories', () => {
			expect(TRIGGER_CATEGORY_LABELS.pm).toBe('Project Management');
			expect(TRIGGER_CATEGORY_LABELS.scm).toBe('Source Control');
			expect(TRIGGER_CATEGORY_LABELS.email).toBe('Email');
			expect(TRIGGER_CATEGORY_LABELS.sms).toBe('SMS');
		});

		it('has exactly 4 categories', () => {
			expect(Object.keys(TRIGGER_CATEGORY_LABELS)).toHaveLength(4);
		});
	});

	describe('type exports', () => {
		it('TriggerParameterValue supports expected types', () => {
			const stringVal: TriggerParameterValue = 'test';
			const boolVal: TriggerParameterValue = true;
			const numVal: TriggerParameterValue = 42;

			expect(typeof stringVal).toBe('string');
			expect(typeof boolVal).toBe('boolean');
			expect(typeof numVal).toBe('number');
		});

		it('TriggerParameterDef has required fields', () => {
			const paramDef: TriggerParameterDef = {
				name: 'testParam',
				type: 'string',
				label: 'Test Parameter',
				description: null,
				required: false,
				defaultValue: null,
				options: null,
			};

			expect(paramDef.name).toBe('testParam');
			expect(paramDef.type).toBe('string');
			expect(paramDef.label).toBe('Test Parameter');
		});

		it('ResolvedTrigger has required fields', () => {
			const trigger: ResolvedTrigger = {
				event: 'pm:status-changed',
				label: 'Status Changed',
				description: null,
				providers: null,
				enabled: true,
				parameters: {},
				parameterDefs: [],
				isCustomized: false,
			};

			expect(trigger.event).toBe('pm:status-changed');
			expect(trigger.enabled).toBe(true);
			expect(trigger.isCustomized).toBe(false);
		});

		it('TriggerCategory is a valid union type', () => {
			const pm: TriggerCategory = 'pm';
			const scm: TriggerCategory = 'scm';
			const email: TriggerCategory = 'email';
			const sms: TriggerCategory = 'sms';

			expect([pm, scm, email, sms]).toEqual(['pm', 'scm', 'email', 'sms']);
		});

		it('ProjectTriggersView has agents and integrations', () => {
			const view: ProjectTriggersView = {
				agents: [
					{
						agentType: 'implementation',
						triggers: [],
					},
				],
				integrations: {
					pm: 'trello',
					scm: 'github',
					email: null,
					sms: null,
				},
			};

			expect(view.agents).toHaveLength(1);
			expect(view.integrations.pm).toBe('trello');
			expect(view.integrations.scm).toBe('github');
		});
	});

	describe('TRIGGER_REGISTRY', () => {
		it('has all four categories', () => {
			expect(Object.keys(TRIGGER_REGISTRY)).toEqual(['pm', 'scm', 'email', 'sms']);
		});

		it('pm category has expected triggers', () => {
			const pmEvents = TRIGGER_REGISTRY.pm.map((t) => t.event);
			expect(pmEvents).toContain('pm:status-changed');
			expect(pmEvents).toContain('pm:label-added');
			expect(pmEvents).toContain('pm:comment-mention');
			// Old provider-specific events should no longer exist
			expect(pmEvents).not.toContain('pm:card-moved');
			expect(pmEvents).not.toContain('pm:issue-transitioned');
		});

		it('scm category has all GitHub triggers including pr-merged and pr-ready-to-merge', () => {
			const scmEvents = TRIGGER_REGISTRY.scm.map((t) => t.event);
			expect(scmEvents).toContain('scm:check-suite-success');
			expect(scmEvents).toContain('scm:check-suite-failure');
			expect(scmEvents).toContain('scm:pr-review-submitted');
			expect(scmEvents).toContain('scm:review-requested');
			expect(scmEvents).toContain('scm:pr-opened');
			expect(scmEvents).toContain('scm:pr-comment');
			expect(scmEvents).toContain('scm:pr-merged');
			expect(scmEvents).toContain('scm:pr-ready-to-merge');
		});

		it('email category has expected triggers', () => {
			const emailEvents = TRIGGER_REGISTRY.email.map((t) => t.event);
			expect(emailEvents).toContain('email:received');
		});

		it('sms category has expected triggers', () => {
			const smsEvents = TRIGGER_REGISTRY.sms.map((t) => t.event);
			expect(smsEvents).toContain('sms:received');
		});

		it('all triggers have required KnownTriggerEvent fields', () => {
			for (const [category, triggers] of Object.entries(TRIGGER_REGISTRY)) {
				for (const trigger of triggers) {
					expect(trigger.event).toBeTruthy();
					expect(trigger.label).toBeTruthy();
					expect(trigger.description).toBeTruthy();
					expect(Array.isArray(trigger.contextPipeline)).toBe(true);
				}
			}
		});

		it('all context pipeline values are valid ContextStepNames', () => {
			const validSteps = new Set(CONTEXT_STEP_NAMES);
			for (const triggers of Object.values(TRIGGER_REGISTRY)) {
				for (const trigger of triggers) {
					for (const step of trigger.contextPipeline) {
						expect(validSteps.has(step)).toBe(true);
					}
				}
			}
		});

		it('all provider values are valid KnownProviders', () => {
			const validProviders = new Set(['trello', 'jira', 'github', 'imap', 'gmail', 'twilio']);
			const allProviders = Object.values(TRIGGER_REGISTRY)
				.flat()
				.flatMap((t) => t.providers ?? []);
			for (const provider of allProviders) {
				expect(validProviders.has(provider)).toBe(true);
			}
		});

		it('scm triggers specify github as provider', () => {
			for (const trigger of TRIGGER_REGISTRY.scm) {
				expect(trigger.providers).toContain('github');
			}
		});

		it('pm:status-changed has no provider restriction (works for all PM providers)', () => {
			const statusChanged = TRIGGER_REGISTRY.pm.find((t) => t.event === 'pm:status-changed');
			expect(statusChanged).toBeDefined();
			// No providers restriction — works with trello and jira alike
			expect(statusChanged?.providers).toBeUndefined();
		});

		it('KnownTriggerEvent type has correct shape', () => {
			const trigger: KnownTriggerEvent = {
				event: 'test:event',
				label: 'Test Event',
				description: 'A test event',
				contextPipeline: ['workItem'],
				providers: ['trello'],
			};

			expect(trigger.event).toBe('test:event');
			expect(trigger.contextPipeline).toEqual(['workItem']);
		});
	});
});
