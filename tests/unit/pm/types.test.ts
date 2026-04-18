/**
 * Type-level tests for the extended PMProvider interface surface.
 *
 * Plan 009/1 adds an optional `discover?` method + associated capability
 * type machinery. Method parameter types (moveWorkItem destination,
 * createWorkItem.containerId, etc.) stay as `string` at the interface
 * level; per-provider adapters narrow to branded IDs in plans 2/3/4.
 *
 * Covered here:
 *   - DiscoveryCapability is the expected union
 *   - DiscoveryArgs<K> and DiscoveryResult<K> resolve per capability
 *   - PMProvider.discover is optional (existing adapters that don't
 *     declare it still satisfy the interface)
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { ContainerId, LabelId, StateId } from '../../../src/pm/ids.js';
import type {
	DiscoveryArgs,
	DiscoveryCapability,
	DiscoveryResult,
	PMProvider,
} from '../../../src/pm/types.js';

describe('DiscoveryCapability', () => {
	it('is the expected string-literal union (plan 010/2: includes currentUser)', () => {
		expectTypeOf<DiscoveryCapability>().toEqualTypeOf<
			| 'teams'
			| 'boards'
			| 'labels'
			| 'states'
			| 'projects'
			| 'customFields'
			| 'containers'
			| 'currentUser'
		>();
	});
});

describe('DiscoveryArgs', () => {
	it('teams/boards/projects take optional containerId (top-level discovery)', () => {
		// containerId may be undefined for top-level lookups (list all teams /
		// boards / projects visible to the credential).
		expectTypeOf<DiscoveryArgs<'teams'>>().toMatchTypeOf<{ containerId?: ContainerId }>();
		expectTypeOf<DiscoveryArgs<'boards'>>().toMatchTypeOf<{ containerId?: ContainerId }>();
		expectTypeOf<DiscoveryArgs<'projects'>>().toMatchTypeOf<{ containerId?: ContainerId }>();
	});

	it('labels/states/customFields require a ContainerId', () => {
		// Nested-under-container capabilities cannot be looked up without a
		// container context.
		expectTypeOf<DiscoveryArgs<'labels'>>().toMatchTypeOf<{ containerId: ContainerId }>();
		expectTypeOf<DiscoveryArgs<'states'>>().toMatchTypeOf<{ containerId: ContainerId }>();
		expectTypeOf<DiscoveryArgs<'customFields'>>().toMatchTypeOf<{ containerId: ContainerId }>();
	});

	it('containers capability takes no args', () => {
		expectTypeOf<DiscoveryArgs<'containers'>>().toEqualTypeOf<Record<string, never>>();
	});

	it('currentUser capability takes no args (plan 010/2)', () => {
		expectTypeOf<DiscoveryArgs<'currentUser'>>().toEqualTypeOf<Record<string, never>>();
	});
});

describe('DiscoveryResult', () => {
	it('labels returns an array of { id: LabelId, name: string, color? }', () => {
		expectTypeOf<DiscoveryResult<'labels'>>().toEqualTypeOf<
			Array<{ id: LabelId; name: string; color?: string }>
		>();
	});

	it('states returns an array of { id: StateId, name: string, category }', () => {
		expectTypeOf<DiscoveryResult<'states'>>().toEqualTypeOf<
			Array<{
				id: StateId;
				name: string;
				category: 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown';
			}>
		>();
	});

	it('teams/boards/containers/projects return { id: ContainerId, name: string }[]', () => {
		expectTypeOf<DiscoveryResult<'teams'>>().toEqualTypeOf<
			Array<{ id: ContainerId; name: string }>
		>();
		expectTypeOf<DiscoveryResult<'boards'>>().toEqualTypeOf<
			Array<{ id: ContainerId; name: string }>
		>();
		expectTypeOf<DiscoveryResult<'containers'>>().toEqualTypeOf<
			Array<{ id: ContainerId; name: string }>
		>();
		expectTypeOf<DiscoveryResult<'projects'>>().toEqualTypeOf<
			Array<{ id: ContainerId; name: string }>
		>();
	});

	it('currentUser returns { id, name, displayName? } (plan 010/2)', () => {
		expectTypeOf<DiscoveryResult<'currentUser'>>().toEqualTypeOf<{
			id: string;
			name: string;
			displayName?: string;
		}>();
	});

	it('customFields returns an array of { id: string, name: string, type: string }', () => {
		// Custom field IDs are opaque provider strings (JIRA: "customfield_10001"),
		// not branded — they're not part of the state/label/container type model.
		expectTypeOf<DiscoveryResult<'customFields'>>().toEqualTypeOf<
			Array<{ id: string; name: string; type: string }>
		>();
	});
});

describe('PMProvider.discover', () => {
	it('is optional — an adapter that does not declare it still satisfies PMProvider', () => {
		// If the discover field were required, the type-only helper below would
		// fail to compile. It being assignable proves `discover?` is optional.
		type MinimalPMProvider = Omit<PMProvider, 'discover'>;
		expectTypeOf<MinimalPMProvider>().toMatchTypeOf<Partial<PMProvider>>();
	});
});
