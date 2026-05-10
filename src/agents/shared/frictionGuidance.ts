import type { Capability } from '../capabilities/index.js';

export const FRICTION_REPORTING_GUIDANCE = `## Friction Reporting

When the ReportFriction tool is available, use it only for incidental papercuts in the environment, tooling, repository setup, documentation, or developer workflow that make the work harder than it should be.

Do not report core task difficulty, expected debugging effort, product ambiguity that belongs in the current work item, or issues you can resolve directly as part of the assigned task.

Keep working after reporting friction unless the issue blocks progress. If blocked, report the friction with concrete context and then explain the blocker in your final response.`;

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
