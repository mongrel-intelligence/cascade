/**
 * Sibling project resolution for shared PM boards (spec 024).
 *
 * CASCADE historically assumed one project per PM board: the router picked the
 * first project whose board key matched, which meant a second project on the
 * same key silently never received an event. This module replaces that guess
 * with an explicit decision over the whole sibling set.
 *
 * Deliberately pure and provider-agnostic — data in, decision out. It performs
 * no I/O and imports nothing, so the full outcome matrix is unit-testable and
 * the same logic can serve other PM providers when they adopt discriminators.
 * Callers own the side effects: routing the event, recording the skip reason,
 * raising observability on ambiguity.
 */

/** The issue attribute that says which sibling an issue belongs to. */
export type PMRoutingDiscriminator = {
	kind: 'label' | 'component';
	value: string;
};

/** One project competing for events on a shared board key. */
export type PMRoutingSibling = {
	projectId: string;
	/** `null` ⇒ this sibling is the default for issues no discriminator claims. */
	discriminator: PMRoutingDiscriminator | null;
};

/** The routing-relevant slice of an incoming issue. */
export type PMRoutingIssueAttributes = {
	labels: readonly string[];
	components: readonly string[];
};

export type PMRoutingOutcome =
	| { action: 'route'; projectId: string }
	| {
			action: 'skip';
			reason: 'no_match' | 'ambiguous';
			/** Operator-facing text; surfaces as the webhook decision reason. */
			message: string;
			candidateProjectIds: string[];
	  };

function describeSibling(sibling: PMRoutingSibling): string {
	return sibling.discriminator
		? `${sibling.projectId} (${sibling.discriminator.kind} "${sibling.discriminator.value}")`
		: `${sibling.projectId} (no discriminator)`;
}

/**
 * Match is exact and case-sensitive: JIRA labels are case-sensitive, and a
 * near-miss must fail loudly rather than route work to the wrong team.
 */
function matches(discriminator: PMRoutingDiscriminator, issue: PMRoutingIssueAttributes): boolean {
	const haystack = discriminator.kind === 'label' ? issue.labels : issue.components;
	return haystack.includes(discriminator.value);
}

/**
 * Decide which sibling owns an issue.
 *
 * Precedence: a single sibling always wins (the historical 1:1 path, untouched
 * by discriminators) → an exact discriminator match wins → the lone
 * discriminator-less sibling is the default → otherwise skip. Both skip paths
 * are deliberate: nothing is ever awarded to a sibling by position, because
 * that is precisely the silent misrouting this module exists to end.
 */
export function resolveProjectAmongSiblings(
	siblings: readonly PMRoutingSibling[],
	issue: PMRoutingIssueAttributes,
): PMRoutingOutcome {
	if (siblings.length === 0) {
		return {
			action: 'skip',
			reason: 'no_match',
			message: 'No project is configured for this board key.',
			candidateProjectIds: [],
		};
	}

	// A lone sibling with no discriminator is every pre-024 deployment: it owns
	// the key unconditionally, exactly as before. A lone sibling that HAS a
	// discriminator does not get that shortcut — it asked to be scoped, and the
	// same scoping governs which work items it reads and creates, so an issue
	// outside its scope must not be routed to it merely for lack of a rival.
	if (siblings.length === 1 && !siblings[0].discriminator) {
		return { action: 'route', projectId: siblings[0].projectId };
	}

	const matched = siblings.filter((s) => s.discriminator && matches(s.discriminator, issue));
	if (matched.length === 1) {
		return { action: 'route', projectId: matched[0].projectId };
	}
	if (matched.length > 1) {
		return {
			action: 'skip',
			reason: 'ambiguous',
			message:
				`Issue matches more than one project's routing discriminator: ` +
				`${matched.map(describeSibling).join(', ')}. Refusing to guess an owner — ` +
				`give the issue exactly one team's discriminator.`,
			candidateProjectIds: matched.map((s) => s.projectId),
		};
	}

	const defaults = siblings.filter((s) => !s.discriminator);
	if (defaults.length === 1) {
		return { action: 'route', projectId: defaults[0].projectId };
	}
	if (defaults.length > 1) {
		return {
			action: 'skip',
			reason: 'ambiguous',
			message:
				`Issue matches no routing discriminator and several projects claim the ` +
				`board key without one: ${defaults.map((s) => s.projectId).join(', ')}. ` +
				`Exactly one project may act as the default.`,
			candidateProjectIds: defaults.map((s) => s.projectId),
		};
	}

	return {
		action: 'skip',
		reason: 'no_match',
		message:
			`Issue matches no routing discriminator on this board key. Evaluated: ` +
			`${siblings.map(describeSibling).join(', ')}. Add the issue to one of those, or ` +
			`configure a project without a discriminator to act as the default.`,
		candidateProjectIds: siblings.map((s) => s.projectId),
	};
}
