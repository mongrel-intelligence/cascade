import type { Capability } from '../capabilities/index.js';

export const FRICTION_REPORTING_GUIDANCE = `## Friction Reporting

When something makes your work harder than it strictly needs to be — at any point during the task — file it with \`ReportFriction\`. When in doubt, report. Better to over-report initial papercuts than let recurring friction go invisible.

After filing, keep working; only let friction block your task if it actually blocks it.`;

export function shouldAppendFrictionGuidance(capabilities: readonly Capability[]): boolean {
	return capabilities.includes('pm:friction');
}

export function appendFrictionGuidance(
	systemPrompt: string,
	capabilities: readonly Capability[],
): string {
	if (!shouldAppendFrictionGuidance(capabilities)) return systemPrompt;
	return `${systemPrompt.trimEnd()}\n\n${FRICTION_REPORTING_GUIDANCE}`;
}
