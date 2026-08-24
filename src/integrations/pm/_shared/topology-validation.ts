/**
 * Save-time validation for shared PM board topologies (spec 024).
 *
 * Routing can only be as good as the configuration it reads. Two projects on
 * one JIRA key with no way to tell their issues apart is not a routing problem
 * to solve at webhook time — it is a configuration that should never have been
 * saveable. Rejecting it here is what turns the old silent-shadowing failure
 * (the second project simply never received an event) into an error the
 * operator sees while they still have the wizard open.
 *
 * Pure and provider-shaped: data in, throw or return. The caller owns the query
 * that produced the siblings.
 */

import { TRPCError } from '@trpc/server';

export type JiraRoutingDiscriminator = { kind: 'label' | 'component'; value: string };

/** A project already configured against the same JIRA key. */
export type JiraTopologySibling = {
	projectId: string;
	config: unknown;
};

function readProjectKey(config: unknown): string | null {
	const key = (config as { projectKey?: unknown } | null)?.projectKey;
	return typeof key === 'string' && key.length > 0 ? key : null;
}

function readDiscriminator(config: unknown): JiraRoutingDiscriminator | null {
	const routing = (config as { routing?: unknown } | null)?.routing as
		| { discriminator?: unknown }
		| undefined;
	const candidate = routing?.discriminator as Partial<JiraRoutingDiscriminator> | undefined;
	if (!candidate) return null;
	if (candidate.kind !== 'label' && candidate.kind !== 'component') return null;
	if (typeof candidate.value !== 'string' || candidate.value.length === 0) return null;
	return { kind: candidate.kind, value: candidate.value };
}

const describe = (d: JiraRoutingDiscriminator) => `${d.kind} "${d.value}"`;

/**
 * Throw unless `projectId` can be saved against this JIRA config.
 *
 * Two rules, both derived from what the router can actually resolve: a key may
 * have at most one project without a discriminator (its default), and no two
 * projects may claim the same discriminator. Everything else is routable.
 *
 * `siblings` may include the project being saved — re-saving an existing
 * project must not conflict with itself.
 */
export function assertJiraTopologyValid(
	projectId: string,
	config: unknown,
	siblings: readonly JiraTopologySibling[],
): void {
	const projectKey = readProjectKey(config);
	if (!projectKey) return;

	const others = siblings.filter(
		(s) => s.projectId !== projectId && readProjectKey(s.config) === projectKey,
	);
	if (others.length === 0) return;

	const mine = readDiscriminator(config);

	if (!mine) {
		const existingDefault = others.find((s) => readDiscriminator(s.config) === null);
		if (existingDefault) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message:
					`JIRA project key "${projectKey}" is already used by project ` +
					`"${existingDefault.projectId}", which also has no routing discriminator. ` +
					`Add a routing discriminator — a label or a component — to one of them so ` +
					`CASCADE can tell their issues apart.`,
			});
		}
		return;
	}

	const clash = others.find((s) => {
		const theirs = readDiscriminator(s.config);
		return theirs !== null && theirs.kind === mine.kind && theirs.value === mine.value;
	});
	if (clash) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message:
				`Project "${clash.projectId}" already routes JIRA key "${projectKey}" by ` +
				`${describe(mine)}. Two projects cannot claim the same routing discriminator — ` +
				`choose a different label or component.`,
		});
	}
}
