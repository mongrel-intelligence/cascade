import { describe, expect, it } from 'vitest';
import {
	AGENT_LABELS,
	ALL_AGENT_TYPES,
	CATEGORY_LABELS,
	EMAIL_TRIGGER_AGENTS,
	LIFECYCLE_TRIGGERS,
	getTriggerValue,
	setTriggerValue,
} from '../../../web/src/lib/trigger-agent-mapping.js';

describe('ALL_AGENT_TYPES', () => {
	it('includes email-joke', () => {
		expect(ALL_AGENT_TYPES).toContain('email-joke');
	});

	it('contains all expected agent types in order', () => {
		expect(ALL_AGENT_TYPES).toEqual([
			'splitting',
			'planning',
			'implementation',
			'review',
			'respond-to-review',
			'respond-to-ci',
			'resolve-conflicts',
			'respond-to-pr-comment',
			'respond-to-planning-comment',
			'email-joke',
		]);
	});
});

describe('AGENT_LABELS', () => {
	it('has a label for every entry in ALL_AGENT_TYPES', () => {
		for (const type of ALL_AGENT_TYPES) {
			expect(AGENT_LABELS).toHaveProperty(type);
			expect(typeof AGENT_LABELS[type]).toBe('string');
			expect(AGENT_LABELS[type].length).toBeGreaterThan(0);
		}
	});

	it('maps email-joke to a friendly label', () => {
		expect(AGENT_LABELS['email-joke']).toBe('Email Joke');
	});

	it('has no entries beyond ALL_AGENT_TYPES', () => {
		const knownTypes = new Set<string>(ALL_AGENT_TYPES);
		for (const key of Object.keys(AGENT_LABELS)) {
			expect(knownTypes).toContain(key);
		}
	});
});

describe('EMAIL_TRIGGER_AGENTS', () => {
	it('contains email-joke', () => {
		expect(EMAIL_TRIGGER_AGENTS.has('email-joke')).toBe(true);
	});

	it('does not contain non-email agents', () => {
		expect(EMAIL_TRIGGER_AGENTS.has('implementation')).toBe(false);
		expect(EMAIL_TRIGGER_AGENTS.has('review')).toBe(false);
		expect(EMAIL_TRIGGER_AGENTS.has('splitting')).toBe(false);
	});

	it('every entry is a known agent type', () => {
		const knownTypes = new Set<string>(ALL_AGENT_TYPES);
		for (const agentType of EMAIL_TRIGGER_AGENTS) {
			expect(knownTypes).toContain(agentType);
		}
	});
});

describe('CATEGORY_LABELS', () => {
	it('exports category labels from shared types', () => {
		expect(CATEGORY_LABELS.pm).toBe('Project Management');
		expect(CATEGORY_LABELS.scm).toBe('Source Control');
	});
});

describe('LIFECYCLE_TRIGGERS', () => {
	it('contains prReadyToMerge and prMerged triggers', () => {
		const keys = LIFECYCLE_TRIGGERS.map((t) => t.key);
		expect(keys).toContain('prReadyToMerge');
		expect(keys).toContain('prMerged');
	});

	it('all triggers have required fields', () => {
		for (const trigger of LIFECYCLE_TRIGGERS) {
			expect(trigger.key).toBeDefined();
			expect(trigger.label).toBeDefined();
			expect(trigger.description).toBeDefined();
			expect(typeof trigger.defaultValue).toBe('boolean');
			expect(trigger.category).toBe('scm');
		}
	});
});

describe('getTriggerValue', () => {
	it('returns default value when key is not present', () => {
		expect(getTriggerValue({}, 'cardMovedToSplitting', true)).toBe(true);
		expect(getTriggerValue({}, 'cardMovedToSplitting', false)).toBe(false);
	});

	it('returns boolean value for simple key', () => {
		expect(getTriggerValue({ cardMovedToSplitting: true }, 'cardMovedToSplitting', false)).toBe(
			true,
		);
		expect(getTriggerValue({ cardMovedToSplitting: false }, 'cardMovedToSplitting', true)).toBe(
			false,
		);
	});

	it('handles nested keys (dot notation)', () => {
		const triggers = {
			readyToProcessLabel: {
				splitting: true,
				planning: false,
			},
		};
		expect(getTriggerValue(triggers, 'readyToProcessLabel.splitting', false)).toBe(true);
		expect(getTriggerValue(triggers, 'readyToProcessLabel.planning', true)).toBe(false);
	});

	it('handles legacy boolean for nested keys', () => {
		const triggers = { readyToProcessLabel: true };
		expect(getTriggerValue(triggers, 'readyToProcessLabel.splitting', false)).toBe(true);
		expect(getTriggerValue(triggers, 'readyToProcessLabel.planning', false)).toBe(true);

		const triggersFalse = { readyToProcessLabel: false };
		expect(getTriggerValue(triggersFalse, 'readyToProcessLabel.splitting', true)).toBe(false);
	});

	it('returns default when nested key is missing from object', () => {
		const triggers = {
			readyToProcessLabel: { splitting: true },
		};
		expect(getTriggerValue(triggers, 'readyToProcessLabel.implementation', true)).toBe(true);
	});
});

describe('setTriggerValue', () => {
	it('sets simple key', () => {
		const result = setTriggerValue({}, 'cardMovedToSplitting', true);
		expect(result.cardMovedToSplitting).toBe(true);
	});

	it('preserves existing keys', () => {
		const result = setTriggerValue({ existingKey: 'value' }, 'newKey', true);
		expect(result.existingKey).toBe('value');
		expect(result.newKey).toBe(true);
	});

	it('sets nested key creating object structure', () => {
		const result = setTriggerValue({}, 'readyToProcessLabel.splitting', true);
		expect(result.readyToProcessLabel).toEqual({ splitting: true });
	});

	it('expands legacy boolean to object when setting nested key', () => {
		const result = setTriggerValue(
			{ readyToProcessLabel: true },
			'readyToProcessLabel.splitting',
			false,
		);
		expect(result.readyToProcessLabel).toEqual({
			splitting: false,
			planning: true,
			implementation: true,
		});
	});

	it('merges into existing nested object', () => {
		const triggers = {
			readyToProcessLabel: { splitting: true, planning: false },
		};
		const result = setTriggerValue(triggers, 'readyToProcessLabel.implementation', true);
		expect(result.readyToProcessLabel).toEqual({
			splitting: true,
			planning: false,
			implementation: true,
		});
	});
});
