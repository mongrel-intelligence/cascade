import { describe, expect, it } from 'vitest';
import { formatFrictionReport } from '../../../src/friction/format.js';
import type { FrictionReport } from '../../../src/friction/types.js';

function makeReport(overrides: Partial<FrictionReport> = {}): FrictionReport {
	return {
		reportId: 'friction-1',
		summary: 'Could not inspect an authenticated Trello attachment',
		details: 'The original attachment URL returned an authorization error during analysis.',
		category: 'pm-data',
		severity: 'medium',
		whileDoing: 'reviewing work item screenshots',
		context: {
			project: {
				id: 'proj-1',
				name: 'Cascade',
				repo: 'acme/cascade',
				pmType: 'trello',
			},
			agent: { type: 'implementation', engine: 'codex', model: 'gpt-5.4' },
			run: {
				id: 'run-1',
				url: 'https://ca.sca.de.com/runs/run-1',
				startedAt: '2026-05-09T17:46:13.000Z',
			},
			workItem: {
				id: 'card-1',
				title: 'Add friction reports',
				url: 'https://trello.com/c/card-1',
			},
			pr: {
				number: 12,
				title: 'feat: example',
				url: 'https://github.com/acme/cascade/pull/12',
				branch: 'feature/example',
				headSha: 'abc123',
			},
		},
		...overrides,
	};
}

describe('formatFrictionReport', () => {
	it('produces a PM-ready title and markdown body with runtime context', () => {
		const formatted = formatFrictionReport(makeReport(), new Date('2026-05-09T18:00:00.000Z'));

		expect(formatted.title).toBe(
			'[Friction][medium] Could not inspect an authenticated Trello attachment',
		);
		expect(formatted.descriptionMarkdown).toContain('## What happened');
		expect(formatted.descriptionMarkdown).toContain(
			'The original attachment URL returned an authorization error during analysis.',
		);
		expect(formatted.descriptionMarkdown).toContain('- Category: pm-data');
		expect(formatted.descriptionMarkdown).toContain(
			'- While doing: reviewing work item screenshots',
		);
		expect(formatted.descriptionMarkdown).toContain('- Project: Cascade (proj-1)');
		expect(formatted.descriptionMarkdown).toContain(
			'- Run: [run-1](https://ca.sca.de.com/runs/run-1)',
		);
		expect(formatted.descriptionMarkdown).toContain(
			'- Work item: [Add friction reports (card-1)](https://trello.com/c/card-1)',
		);
		expect(formatted.descriptionMarkdown).toContain(
			'- Pull request: [#12 feat: example](https://github.com/acme/cascade/pull/12)',
		);
		expect(formatted.descriptionMarkdown).toContain('2026-05-09T18:00:00.000Z');
		expect(formatted.descriptionMarkdown).not.toMatch(/resolution plan/i);
	});

	it('prefers report.createdAt over the formatter clock', () => {
		const formatted = formatFrictionReport(
			makeReport({ createdAt: '2026-05-09T17:00:00.000Z' }),
			new Date('2026-05-09T18:00:00.000Z'),
		);

		expect(formatted.descriptionMarkdown).toContain('2026-05-09T17:00:00.000Z');
		expect(formatted.descriptionMarkdown).not.toContain('2026-05-09T18:00:00.000Z');
	});

	it('truncates long PM titles', () => {
		const formatted = formatFrictionReport(
			makeReport({ summary: 'x'.repeat(200), severity: 'high' }),
			new Date('2026-05-09T18:00:00.000Z'),
		);

		expect(formatted.title).toHaveLength(120);
		expect(formatted.title.endsWith('...')).toBe(true);
	});
});
