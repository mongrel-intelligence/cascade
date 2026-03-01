import { describe, expect, it } from 'vitest';
import {
	type ProjectTriggersView,
	type ResolvedTrigger,
	TRIGGER_CATEGORY_LABELS,
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
				event: 'pm:card-moved',
				label: 'Card Moved',
				description: null,
				providers: ['trello'],
				enabled: true,
				parameters: {},
				parameterDefs: [],
				isCustomized: false,
			};

			expect(trigger.event).toBe('pm:card-moved');
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
});
