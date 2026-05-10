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
				headSha: 'abc123def4567890',
			},
		},
		...overrides,
	};
}

describe('formatFrictionReport', () => {
	// 2026-05-10 rewrite: title now surfaces all three classification facets
	// (Friction · category · severity) inside a single bracket pair so PM
	// systems slugify it cleanly (e.g. `friction-pm-data-medium-...`). The
	// prior `[Friction][medium]` form concatenated to ugly `frictionmedium-...`
	// because the brackets had no separator. Body dropped the redundant
	// `## What happened` (title carries summary), `## Classification` (category
	// + severity in title; whileDoing migrated into Run context), and
	// `## Timestamp` header (italic footer instead — provider's createdAt
	// already surfaces this).
	it('title surfaces Friction · category · severity in a single bracket pair', () => {
		const formatted = formatFrictionReport(makeReport(), new Date('2026-05-09T18:00:00.000Z'));

		expect(formatted.title).toBe(
			'[Friction · pm-data · medium] Could not inspect an authenticated Trello attachment',
		);
		// Pin the absence of the prior bracket-concat form so reverts fail loudly.
		expect(formatted.title).not.toContain('[Friction][medium]');
	});

	it('body has only `## Details` and `## Run context` sections plus an italic timestamp footer', () => {
		const md = formatFrictionReport(
			makeReport(),
			new Date('2026-05-09T18:00:00.000Z'),
		).descriptionMarkdown;

		// Two — and ONLY two — markdown headings.
		const headings = md.split('\n').filter((l) => l.startsWith('## '));
		expect(headings).toEqual(['## Details', '## Run context']);

		// Removed sections — pin loudly so a partial revert fails this test.
		expect(md).not.toContain('## What happened');
		expect(md).not.toContain('## Classification');
		expect(md).not.toContain('## Timestamp');
		expect(md).not.toContain('- Category:');
		expect(md).not.toContain('- Severity:');

		// Details section carries the agent's verbatim prose.
		expect(md).toContain('## Details');
		expect(md).toContain(
			'The original attachment URL returned an authorization error during analysis.',
		);

		// Italic timestamp footer (not a section header).
		expect(md.trim().endsWith('_Reported 2026-05-09T18:00:00.000Z_')).toBe(true);
	});

	it('Run context renders compact bold-keyed bullets — Run / Work item / PR / Project / While doing', () => {
		const md = formatFrictionReport(
			makeReport(),
			new Date('2026-05-09T18:00:00.000Z'),
		).descriptionMarkdown;

		// Run line: link + agent type + engine/model meta.
		expect(md).toContain(
			'- **Run:** [run-1](https://ca.sca.de.com/runs/run-1) — implementation · codex/gpt-5.4',
		);
		// Work item with bold key, title, monospaced id, and link.
		expect(md).toContain(
			'- **Work item:** [Add friction reports (`card-1`)](https://trello.com/c/card-1)',
		);
		// PR line: branch + 12-char head SHA inline.
		expect(md).toContain(
			'- **PR:** [#12 feat: example](https://github.com/acme/cascade/pull/12) — `feature/example` @ `abc123def456`',
		);
		// Project — single dense line with id, repo, and pm type.
		expect(md).toContain('- **Project:** `proj-1` — acme/cascade (trello)');
		// While doing migrated into run context.
		expect(md).toContain('- **While doing:** reviewing work item screenshots');
	});

	it('drops PR / Work item lines entirely when the report has no PR or work item context', () => {
		const md = formatFrictionReport(
			makeReport({
				context: {
					project: { id: 'proj-1', pmType: 'trello' },
					agent: { type: 'planning', engine: 'codex', model: 'gpt-5.4' },
					run: { id: 'run-1', url: 'https://ca.sca.de.com/runs/run-1' },
				},
			}),
			new Date('2026-05-09T18:00:00.000Z'),
		).descriptionMarkdown;

		// No placeholders for absent context; lines just don't render.
		expect(md).not.toContain('**Work item:**');
		expect(md).not.toContain('**PR:**');
		expect(md).not.toContain('_not provided_');
		// Run + Project + While doing still present.
		expect(md).toContain('**Run:**');
		expect(md).toContain('**Project:**');
		expect(md).toContain('**While doing:**');
	});

	it('prefers report.createdAt over the formatter clock for the italic timestamp footer', () => {
		const formatted = formatFrictionReport(
			makeReport({ createdAt: '2026-05-09T17:00:00.000Z' }),
			new Date('2026-05-09T18:00:00.000Z'),
		);

		expect(formatted.descriptionMarkdown).toContain('_Reported 2026-05-09T17:00:00.000Z_');
		expect(formatted.descriptionMarkdown).not.toContain('2026-05-09T18:00:00.000Z');
	});

	it('truncates long PM titles to 120 chars with an ellipsis', () => {
		const formatted = formatFrictionReport(
			makeReport({ summary: 'x'.repeat(200), severity: 'high' }),
			new Date('2026-05-09T18:00:00.000Z'),
		);

		expect(formatted.title).toHaveLength(120);
		expect(formatted.title.endsWith('...')).toBe(true);
	});
});
