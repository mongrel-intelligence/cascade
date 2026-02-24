import { describe, expect, it } from 'vitest';
import { getTriggersForAgent } from '../../../web/src/lib/trigger-agent-mapping.js';

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
