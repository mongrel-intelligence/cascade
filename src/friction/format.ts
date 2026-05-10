import type { FormattedFrictionReport, FrictionReport } from './types.js';

const TITLE_LIMIT = 120;

function truncateTitle(value: string): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= TITLE_LIMIT) return normalized;
	return `${normalized.slice(0, TITLE_LIMIT - 3).trimEnd()}...`;
}

function valueOrMissing(value: string | number | undefined): string {
	if (value === undefined || value === '') return '_not provided_';
	return String(value);
}

function maybeLink(label: string, url: string | undefined): string {
	return url ? `[${label}](${url})` : label;
}

function formatPRLabel(pr: NonNullable<FrictionReport['context']['pr']>): string {
	if (!pr.number) return valueOrMissing(pr.title);
	return `#${pr.number}${pr.title ? ` ${pr.title}` : ''}`;
}

/**
 * Compact run-context bullets for the friction card body.
 *
 * Optimized for the operator triaging the card: bold-keyed, dense, key
 * facts inline. Mirrors the field-list style of the Sentry alert formatter
 * (`src/integrations/alerting/_shared/format.ts:formatSentryCardBody`).
 *
 * Order is run-first because the run URL is the GOLD piece — it links to
 * the full agent transcript (`cascade runs logs <runId>` and the LLM-call
 * stream). Work item, PR, project, and whileDoing follow. Lines for absent
 * fields are dropped entirely; no `_not provided_` placeholders for
 * conditional context (we keep that placeholder only inside line text where
 * one fragment of an otherwise-present line is missing).
 */
function runContextLines(report: FrictionReport): string[] {
	const { project, agent, run, workItem, pr } = report.context;
	const lines: string[] = [];

	if (run) {
		const engineModel =
			agent?.engine && agent?.model
				? `${agent.engine}/${agent.model}`
				: (agent?.engine ?? agent?.model);
		const meta = [agent?.type, engineModel].filter(Boolean).join(' · ');
		const runLabel = maybeLink(valueOrMissing(run.id), run.url);
		lines.push(`- **Run:** ${runLabel}${meta ? ` — ${meta}` : ''}`);
	}

	if (workItem) {
		const idSuffix = workItem.id ? ` (\`${workItem.id}\`)` : '';
		const label = workItem.title ? `${workItem.title}${idSuffix}` : valueOrMissing(workItem.id);
		lines.push(`- **Work item:** ${maybeLink(label, workItem.url)}`);
	}

	if (pr) {
		const branch = pr.branch ? ` — \`${pr.branch}\`` : '';
		const sha = pr.headSha ? ` @ \`${pr.headSha.slice(0, 12)}\`` : '';
		lines.push(`- **PR:** ${maybeLink(formatPRLabel(pr), pr.url)}${branch}${sha}`);
	}

	const repoSuffix = project.repo ? ` — ${project.repo}` : '';
	const pmSuffix = project.pmType ? ` (${project.pmType})` : '';
	lines.push(`- **Project:** \`${project.id}\`${repoSuffix}${pmSuffix}`);

	lines.push(`- **While doing:** ${report.whileDoing}`);

	return lines;
}

/**
 * Render the FrictionReport into the title + descriptionMarkdown that the
 * PM materializer feeds to `provider.createWorkItem`.
 *
 * Title: `[Friction · <category> · <severity>] <summary>`. Surfaces all
 * three classification facets at the top of operator triage views and
 * produces clean hyphenated slugs (`friction-tooling-low-...`) — the
 * earlier `[Friction][low]` form concatenated to ugly `frictionlow-...`
 * because the brackets had no separator.
 *
 * Body has two semantic sections:
 *   - `## Details` (agent's free-form prose, verbatim — most worth reading)
 *   - `## Run context` (compact bold-keyed bullets — what operator needs to triage)
 *   - italic `_Reported <iso>_` footer (machine-time precision; PM provider's
 *     native createdAt already surfaces this so no need for a section header)
 *
 * Removed (vs the prior format) — all redundant with content already
 * surfaced elsewhere:
 *   - `## What happened` + summary (title carries summary)
 *   - `## Classification` block (category/severity in title; whileDoing
 *     migrated to run-context)
 *   - `## Timestamp` header (provider's native field already shows this)
 */
export function formatFrictionReport(
	report: FrictionReport,
	now: Date = new Date(),
): FormattedFrictionReport {
	const timestamp = report.createdAt ?? now.toISOString();
	const title = truncateTitle(
		`[Friction · ${report.category} · ${report.severity}] ${report.summary}`,
	);

	return {
		title,
		descriptionMarkdown: [
			'## Details',
			report.details,
			'',
			'## Run context',
			...runContextLines(report),
			'',
			`_Reported ${timestamp}_`,
		].join('\n'),
	};
}
