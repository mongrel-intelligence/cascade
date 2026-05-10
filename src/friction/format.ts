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

function projectContextLines(report: FrictionReport): string[] {
	const { project } = report.context;
	return [
		`- Project: ${valueOrMissing(project.name ?? project.id)} (${project.id})`,
		`- PM provider: ${valueOrMissing(project.pmType)}`,
		...(project.repo ? [`- Repository: ${project.repo}`] : []),
	];
}

function optionalContextLines(report: FrictionReport): string[] {
	const { agent, run, workItem, pr } = report.context;
	const lines: string[] = [];

	if (agent) {
		const agentParts = [
			agent.type,
			agent.engine && `engine=${agent.engine}`,
			agent.model && `model=${agent.model}`,
		].filter(Boolean);
		lines.push(`- Agent: ${agentParts.join(' - ')}`);
	}
	if (run) lines.push(`- Run: ${maybeLink(valueOrMissing(run.id), run.url)}`);
	if (run?.startedAt) lines.push(`- Run started: ${run.startedAt}`);
	if (workItem) {
		const label = workItem.title
			? `${workItem.title} (${valueOrMissing(workItem.id)})`
			: valueOrMissing(workItem.id);
		lines.push(`- Work item: ${maybeLink(label, workItem.url)}`);
	}
	if (pr) lines.push(`- Pull request: ${maybeLink(formatPRLabel(pr), pr.url)}`);
	if (pr?.branch) lines.push(`- PR branch: ${pr.branch}`);
	if (pr?.headSha) lines.push(`- PR head SHA: ${pr.headSha}`);

	return lines;
}

function formatPRLabel(pr: NonNullable<FrictionReport['context']['pr']>): string {
	if (!pr.number) return valueOrMissing(pr.title);
	return `#${pr.number}${pr.title ? ` ${pr.title}` : ''}`;
}

function contextLines(report: FrictionReport): string[] {
	return [...projectContextLines(report), ...optionalContextLines(report)];
}

export function formatFrictionReport(
	report: FrictionReport,
	now: Date = new Date(),
): FormattedFrictionReport {
	const timestamp = report.createdAt ?? now.toISOString();
	const title = truncateTitle(`[Friction][${report.severity}] ${report.summary}`);

	return {
		title,
		descriptionMarkdown: [
			'## What happened',
			report.summary,
			'',
			'## Details',
			report.details,
			'',
			'## Classification',
			`- Category: ${report.category}`,
			`- Severity: ${report.severity}`,
			`- While doing: ${report.whileDoing}`,
			'',
			'## Context',
			...contextLines(report),
			'',
			'## Timestamp',
			timestamp,
		].join('\n'),
	};
}
