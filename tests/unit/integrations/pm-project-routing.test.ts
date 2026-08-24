/**
 * Spec 024 plan 1 — the JIRA routing discriminator field and the pure
 * sibling-resolution logic that consumes it.
 *
 * Both halves are dormant in this plan: nothing reads the config field and
 * nothing calls the resolver until plan 2 wires it into the JIRA router
 * adapter. These tests pin the contract those later plans build on.
 */
import { describe, expect, it } from 'vitest';
import {
	type PMRoutingSibling,
	resolveProjectAmongSiblings,
} from '../../../src/integrations/pm/_shared/project-routing.js';
import { jiraConfigSchema } from '../../../src/integrations/pm/jira/config-schema.js';

const baseConfig = {
	projectKey: 'CLFX',
	baseUrl: 'https://acme.atlassian.net',
	statuses: { todo: '1', done: '13103' },
};

describe('jiraConfigSchema — routing discriminator', () => {
	it('accepts a label discriminator and round-trips it', () => {
		const input = {
			...baseConfig,
			routing: { discriminator: { kind: 'label', value: 'team-be' } },
		};
		const parsed = jiraConfigSchema.parse(input);
		expect(parsed.routing).toEqual({ discriminator: { kind: 'label', value: 'team-be' } });
		// Round-trip: re-parsing the parsed output preserves the field, which is
		// what the conformance harness's config round-trip asserts for every
		// manifest-owned schema.
		expect(jiraConfigSchema.parse(parsed).routing).toEqual(parsed.routing);
	});

	it('accepts a component discriminator', () => {
		const parsed = jiraConfigSchema.parse({
			...baseConfig,
			routing: { discriminator: { kind: 'component', value: 'Backend' } },
		});
		expect(parsed.routing?.discriminator.kind).toBe('component');
		expect(parsed.routing?.discriminator.value).toBe('Backend');
	});

	it('rejects an unknown discriminator kind', () => {
		expect(() =>
			jiraConfigSchema.parse({
				...baseConfig,
				routing: { discriminator: { kind: 'sprint', value: 'S1' } },
			}),
		).toThrow();
	});

	it('rejects an empty discriminator value', () => {
		expect(() =>
			jiraConfigSchema.parse({
				...baseConfig,
				routing: { discriminator: { kind: 'label', value: '' } },
			}),
		).toThrow();
	});

	it('parses a config with no routing field (backward compatibility)', () => {
		// AC #12 pin: every existing saved config must stay valid untouched, and
		// must not gain a `routing` key on parse.
		const parsed = jiraConfigSchema.parse(baseConfig);
		expect(parsed.routing).toBeUndefined();
		expect('routing' in parsed).toBe(false);
	});
});

const label = (projectId: string, value: string): PMRoutingSibling => ({
	projectId,
	discriminator: { kind: 'label', value },
});
const component = (projectId: string, value: string): PMRoutingSibling => ({
	projectId,
	discriminator: { kind: 'component', value },
});
const plain = (projectId: string): PMRoutingSibling => ({ projectId, discriminator: null });
const issue = (labels: string[] = [], components: string[] = []) => ({ labels, components });

describe('resolveProjectAmongSiblings', () => {
	it('routes unconditionally when one sibling holds the key', () => {
		// AC #12 pin: the single-project case never consults discriminators, so
		// today's deployments behave identically no matter what an issue carries.
		const out = resolveProjectAmongSiblings([plain('solo')], issue(['anything']));
		expect(out).toEqual({ action: 'route', projectId: 'solo' });
	});

	it('routes to the sibling whose label the issue carries', () => {
		const out = resolveProjectAmongSiblings(
			[label('be', 'team-be'), label('fe', 'team-fe')],
			issue(['team-fe']),
		);
		expect(out).toEqual({ action: 'route', projectId: 'fe' });
	});

	it('routes on a component discriminator', () => {
		const out = resolveProjectAmongSiblings(
			[component('be', 'Backend'), label('fe', 'team-fe')],
			issue([], ['Backend']),
		);
		expect(out).toEqual({ action: 'route', projectId: 'be' });
	});

	it('matches discriminators of different kinds independently', () => {
		const siblings = [label('be', 'team-be'), component('fe', 'Frontend')];
		expect(resolveProjectAmongSiblings(siblings, issue(['team-be'], ['Frontend']))).toMatchObject({
			action: 'skip',
			reason: 'ambiguous',
		});
		expect(resolveProjectAmongSiblings(siblings, issue([], ['Frontend']))).toEqual({
			action: 'route',
			projectId: 'fe',
		});
	});

	it('falls back to the discriminator-less default when nothing matches', () => {
		const out = resolveProjectAmongSiblings([label('be', 'team-be'), plain('fe')], issue([]));
		expect(out).toEqual({ action: 'route', projectId: 'fe' });
	});

	it('skips with reason no_match, naming the discriminators it evaluated', () => {
		const out = resolveProjectAmongSiblings(
			[label('be', 'team-be'), component('fe', 'Frontend')],
			issue(['unrelated']),
		);
		expect(out).toMatchObject({ action: 'skip', reason: 'no_match' });
		if (out.action !== 'skip') throw new Error('expected skip');
		// The message becomes the operator-visible webhook decision reason in
		// plan 2, so it must name every candidate and its discriminator.
		expect(out.message).toContain('team-be');
		expect(out.message).toContain('Frontend');
		expect(out.message).toContain('be');
		expect(out.message).toContain('fe');
		expect(out.candidateProjectIds).toEqual(['be', 'fe']);
	});

	it('skips as ambiguous when an issue matches two siblings', () => {
		const out = resolveProjectAmongSiblings(
			[label('be', 'team-be'), label('fe', 'team-fe')],
			issue(['team-be', 'team-fe']),
		);
		expect(out).toMatchObject({ action: 'skip', reason: 'ambiguous' });
		if (out.action !== 'skip') throw new Error('expected skip');
		expect(out.candidateProjectIds).toEqual(['be', 'fe']);
	});

	it('skips as ambiguous when two siblings are both discriminator-less defaults', () => {
		// Save-time validation (plan 2) prevents this, but a runtime that meets it
		// anyway degrades loudly rather than silently picking a winner.
		const out = resolveProjectAmongSiblings([plain('a'), plain('b')], issue(['x']));
		expect(out).toMatchObject({ action: 'skip', reason: 'ambiguous' });
	});

	it('matches discriminator values case-sensitively', () => {
		// JIRA labels are case-sensitive; a near-miss must not silently route.
		const out = resolveProjectAmongSiblings(
			[label('be', 'team-be'), plain('fe')],
			issue(['Team-BE']),
		);
		expect(out).toEqual({ action: 'route', projectId: 'fe' });
	});

	it('skips with no_match when the key has no siblings at all', () => {
		const out = resolveProjectAmongSiblings([], issue(['team-be']));
		expect(out).toMatchObject({ action: 'skip', reason: 'no_match' });
	});
});
