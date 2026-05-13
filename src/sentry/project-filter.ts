import type {
	SentryAugmentedPayload,
	SentryHookResource,
	SentryIssueAlertPayload,
	SentryIssuePayload,
	SentryMetricAlertPayload,
	SentryWebhookPayload,
} from './types.js';

export interface SentryProjectCandidate {
	id?: string;
	slug?: string;
	name?: string;
	source: string;
}

export type SentryProjectMatchReason =
	| 'matched'
	| 'missing_configured_project'
	| 'missing_payload_project'
	| 'project_mismatch';

export interface SentryProjectMatchResult {
	allowed: boolean;
	reason: SentryProjectMatchReason;
	configuredProjectSlug: string | null;
	payloadProjects: SentryProjectCandidate[];
}

export function formatSentryProjectMatchFailure(result: SentryProjectMatchResult): string {
	const configuredProject = result.configuredProjectSlug ?? '(missing)';
	const payloadProjects =
		result.payloadProjects
			.map((project) => {
				const identifiers = [
					project.id ? `id=${project.id}` : null,
					project.slug ? `slug=${project.slug}` : null,
					project.name ? `name=${project.name}` : null,
				]
					.filter(Boolean)
					.join(',');
				return `${project.source}{${identifiers}}`;
			})
			.join('; ') || '(missing)';

	return `${result.reason}: configuredProjectSlug=${configuredProject}; payloadProjects=${payloadProjects}`;
}

type ProjectLike = {
	project?: unknown;
	id?: unknown;
	slug?: unknown;
	name?: unknown;
	project_slug?: unknown;
	projectSlug?: unknown;
};

export function extractSentryPayloadProjects(
	input: SentryAugmentedPayload | SentryWebhookPayload,
	resourceOverride?: SentryHookResource,
): SentryProjectCandidate[] {
	const { resource, payload } = unwrapPayload(input, resourceOverride);
	if (!payload) return [];

	switch (resource) {
		case 'event_alert':
			return extractEventAlertProjects(payload as SentryIssueAlertPayload);
		case 'metric_alert':
			return extractMetricAlertProjects(payload as SentryMetricAlertPayload);
		case 'issue':
			return extractIssueProjects(payload as SentryIssuePayload);
		default:
			return [];
	}
}

export function matchSentryPayloadProject(
	input: SentryAugmentedPayload | SentryWebhookPayload,
	configuredProjectSlug: string | null | undefined,
	resourceOverride?: SentryHookResource,
): SentryProjectMatchResult {
	const normalizedConfiguredProjectSlug = normalizeComparable(configuredProjectSlug);
	const payloadProjects = extractSentryPayloadProjects(input, resourceOverride);

	if (!normalizedConfiguredProjectSlug) {
		return {
			allowed: false,
			reason: 'missing_configured_project',
			configuredProjectSlug: null,
			payloadProjects,
		};
	}

	const trimmedConfiguredProjectSlug = configuredProjectSlug?.trim() ?? '';
	if (payloadProjects.length === 0) {
		return {
			allowed: false,
			reason: 'missing_payload_project',
			configuredProjectSlug: trimmedConfiguredProjectSlug,
			payloadProjects,
		};
	}

	const allowed = payloadProjects.some((project) =>
		projectMatches(project, trimmedConfiguredProjectSlug, normalizedConfiguredProjectSlug),
	);

	return {
		allowed,
		reason: allowed ? 'matched' : 'project_mismatch',
		configuredProjectSlug: trimmedConfiguredProjectSlug,
		payloadProjects,
	};
}

function unwrapPayload(
	input: SentryAugmentedPayload | SentryWebhookPayload,
	resourceOverride?: SentryHookResource,
): { resource?: SentryHookResource; payload?: SentryWebhookPayload } {
	if (isRecord(input) && 'payload' in input && 'resource' in input) {
		const resource = typeof input.resource === 'string' ? input.resource : resourceOverride;
		return {
			resource: resource as SentryHookResource | undefined,
			payload: input.payload as SentryWebhookPayload | undefined,
		};
	}

	return {
		resource: resourceOverride ?? inferResource(input as SentryWebhookPayload),
		payload: input as SentryWebhookPayload,
	};
}

function inferResource(payload: SentryWebhookPayload): SentryHookResource | undefined {
	if (!isRecord(payload)) return undefined;
	if (isRecord(payload.data) && 'event' in payload.data) return 'event_alert';
	if (isRecord(payload.data) && 'metric_alert' in payload.data) return 'metric_alert';
	if (isRecord(payload.data) && 'issue' in payload.data) return 'issue';
	return undefined;
}

function extractEventAlertProjects(payload: SentryIssueAlertPayload): SentryProjectCandidate[] {
	const event = payload.data?.event as ProjectLike | undefined;
	if (!isRecord(event)) return [];

	return compactCandidates([
		candidateFromProjectValue(event.project, 'data.event.project'),
		candidateFromString(event.project_slug, 'data.event.project_slug', 'slug'),
		candidateFromString(event.projectSlug, 'data.event.projectSlug', 'slug'),
	]);
}

function extractMetricAlertProjects(payload: SentryMetricAlertPayload): SentryProjectCandidate[] {
	const projects = payload.data?.metric_alert?.projects;
	if (!Array.isArray(projects)) return [];

	return compactCandidates(
		projects.map((project, index) =>
			candidateFromProjectValue(project, `data.metric_alert.projects[${index}]`),
		),
	);
}

function extractIssueProjects(payload: SentryIssuePayload): SentryProjectCandidate[] {
	const project = payload.data?.issue?.project;
	return compactCandidates([candidateFromProjectValue(project, 'data.issue.project')]);
}

function candidateFromProjectValue(value: unknown, source: string): SentryProjectCandidate | null {
	if (typeof value === 'string') {
		return candidateFromString(value, source, 'slug');
	}

	if (!isRecord(value)) return null;

	const candidate: SentryProjectCandidate = { source };
	const id = normalizeDisplayString(value.id);
	const slug = normalizeDisplayString(value.slug ?? value.project_slug ?? value.projectSlug);
	const name = normalizeDisplayString(value.name);

	if (id) candidate.id = id;
	if (slug) candidate.slug = slug;
	if (name) candidate.name = name;

	return hasProjectIdentifier(candidate) ? candidate : null;
}

function candidateFromString(
	value: unknown,
	source: string,
	field: 'slug' | 'name',
): SentryProjectCandidate | null {
	const normalized = normalizeDisplayString(value);
	if (!normalized) return null;

	return {
		[field]: normalized,
		source,
	};
}

function compactCandidates(
	candidates: Array<SentryProjectCandidate | null>,
): SentryProjectCandidate[] {
	return candidates.filter((candidate): candidate is SentryProjectCandidate => candidate !== null);
}

function projectMatches(
	project: SentryProjectCandidate,
	trimmedConfiguredProjectSlug: string,
	normalizedConfiguredProjectSlug: string,
): boolean {
	if (project.id === trimmedConfiguredProjectSlug) return true;

	return (
		normalizeComparable(project.slug) === normalizedConfiguredProjectSlug ||
		normalizeComparable(project.name) === normalizedConfiguredProjectSlug
	);
}

function hasProjectIdentifier(candidate: SentryProjectCandidate): boolean {
	return Boolean(candidate.id || candidate.slug || candidate.name);
}

function normalizeDisplayString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeComparable(value: unknown): string | null {
	return normalizeDisplayString(value)?.toLocaleLowerCase() ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
