import { describe, expect, it } from 'vitest';
import {
	AGENT_LABELS,
	ALL_AGENT_TYPES,
	EMAIL_TRIGGER_AGENTS,
	getTriggersForAgent,
} from '../../../web/src/lib/trigger-agent-mapping.js';

describe('getTriggersForAgent', () => {
	it('returns all triggers when no opts given (backward compatibility)', () => {
		const triggers = getTriggersForAgent('review');
		expect(triggers).toHaveLength(4);
		expect(triggers.map((t) => t.key)).toEqual([
			'reviewTrigger.ownPrsOnly',
			'reviewTrigger.externalPrs',
			'reviewTrigger.onReviewRequested',
			'prOpened',
		]);
	});

	it('returns empty array for review agent with category: pm', () => {
		const triggers = getTriggersForAgent('review', { category: 'pm' });
		expect(triggers).toHaveLength(0);
	});

	it('returns 4 review triggers for review agent with category: scm', () => {
		const triggers = getTriggersForAgent('review', { category: 'scm' });
		expect(triggers).toHaveLength(4);
		for (const t of triggers) {
			expect(t.category).toBe('scm');
		}
	});

	it('returns PM-only triggers for splitting with category: pm and pmProvider: trello', () => {
		const triggers = getTriggersForAgent('splitting', { category: 'pm', pmProvider: 'trello' });
		expect(triggers.length).toBeGreaterThan(0);
		for (const t of triggers) {
			expect(t.category).toBe('pm');
			// Should not include JIRA-only triggers
			if (t.pmProvider) {
				expect(t.pmProvider).toBe('trello');
			}
		}
		const keys = triggers.map((t) => t.key);
		expect(keys).toContain('cardMovedToSplitting');
		expect(keys).toContain('readyToProcessLabel.splitting');
		expect(keys).not.toContain('issueTransitioned.splitting');
	});

	it('returns empty array for splitting with category: scm', () => {
		const triggers = getTriggersForAgent('splitting', { category: 'scm' });
		expect(triggers).toHaveLength(0);
	});

	it('filters by pmProvider without category', () => {
		const jiraTriggers = getTriggersForAgent('splitting', { pmProvider: 'jira' });
		const trelloTriggers = getTriggersForAgent('splitting', { pmProvider: 'trello' });
		// JIRA provider should exclude cardMovedToSplitting (trello-only)
		expect(jiraTriggers.map((t) => t.key)).not.toContain('cardMovedToSplitting');
		// Trello provider should exclude issueTransitioned.splitting (jira-only)
		expect(trelloTriggers.map((t) => t.key)).not.toContain('issueTransitioned.splitting');
	});

	it('returns empty array for unknown agent type', () => {
		const triggers = getTriggersForAgent('unknown-agent', { category: 'pm' });
		expect(triggers).toHaveLength(0);
	});
});

describe('getTriggersForAgent — review trigger dot-notation keys and defaults', () => {
	it('returns dot-notation keys for review SCM triggers', () => {
		const triggerDefs = getTriggersForAgent('review', { category: 'scm' });

		// Verify that the trigger definitions have the expected dot-notation keys
		expect(triggerDefs.map((t) => t.key)).toEqual([
			'reviewTrigger.ownPrsOnly',
			'reviewTrigger.externalPrs',
			'reviewTrigger.onReviewRequested',
			'prOpened',
		]);

		// Verify each trigger has the correct category
		for (const t of triggerDefs) {
			expect(t.category).toBe('scm');
		}
	});

	it('returns correct defaultValues for review triggers', () => {
		const triggers = getTriggersForAgent('review', { category: 'scm' });
		const defaults = Object.fromEntries(triggers.map((t) => [t.key, t.defaultValue]));
		expect(defaults['reviewTrigger.ownPrsOnly']).toBe(false);
		expect(defaults['reviewTrigger.externalPrs']).toBe(false);
		expect(defaults['reviewTrigger.onReviewRequested']).toBe(false);
		expect(defaults.prOpened).toBe(false);
	});
});

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

describe('getTriggersForAgent — email-joke', () => {
	it('returns empty array for email-joke (triggers are handled by a custom widget, not toggles)', () => {
		expect(getTriggersForAgent('email-joke')).toHaveLength(0);
	});

	it('returns empty array for email-joke with category: pm', () => {
		expect(getTriggersForAgent('email-joke', { category: 'pm' })).toHaveLength(0);
	});

	it('returns empty array for email-joke with category: scm', () => {
		expect(getTriggersForAgent('email-joke', { category: 'scm' })).toHaveLength(0);
	});
});
