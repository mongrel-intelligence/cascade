import {
	getFrictionContainerId,
	getFrictionLabelId,
	getFrictionStatusDestination,
} from '../pm/config.js';
import { pmRegistry } from '../pm/registry.js';
import type { ProjectConfig } from '../types/index.js';
import { formatFrictionReport } from './format.js';
import type { FrictionMaterializationResult, FrictionReport } from './types.js';

export interface MaterializeFrictionReportOptions {
	project: ProjectConfig;
	report: FrictionReport;
	now?: Date;
}

export async function materializeFrictionReport({
	project,
	report,
	now,
}: MaterializeFrictionReportOptions): Promise<FrictionMaterializationResult> {
	const containerId = getFrictionContainerId(project);
	if (!containerId) {
		return {
			status: 'skipped',
			reportId: report.reportId,
			reason: 'friction_slot_missing',
			message:
				`Project ${project.id} (pm.type=${project.pm?.type ?? 'unknown'}) has no 'friction' slot configured. ` +
				`Set lists.friction (Trello) or statuses.friction (JIRA, Linear) in the PM integration config.`,
		};
	}

	const provider = pmRegistry.createProvider(project);
	const formatted = formatFrictionReport(report, now);
	// Apply the optional `cascade-friction` label when configured. Mirrors
	// the spec-019 `cascade-alert` opt-in pattern: operators add the label
	// to PM integration config when they want filtering/clustering on
	// friction cards; absent config means cards file unlabeled and behavior
	// is unchanged from the prior release.
	const labelId = getFrictionLabelId(project);
	const labels = labelId ? [labelId] : [];
	const workItem = await provider.createWorkItem({
		containerId,
		title: formatted.title,
		description: formatted.descriptionMarkdown,
		labels,
	});

	const destination = getFrictionStatusDestination(project);
	if (destination) {
		await provider.moveWorkItem(workItem.id, destination);
	}

	return {
		status: 'filed',
		reportId: report.reportId,
		workItemId: workItem.id,
		workItemUrl: workItem.url || provider.getWorkItemUrl(workItem.id),
	};
}
