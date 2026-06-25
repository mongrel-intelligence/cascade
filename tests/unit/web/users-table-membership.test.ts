/**
 * Tests for the membership-based member-list display model (spec 021 plan 4,
 * AC #5). `UsersTable` itself wires react-query + radix dialogs, so the display
 * contract is extracted into pure helpers and asserted here.
 */

import { describe, expect, it } from 'vitest';
import {
	describeMemberRow,
	roleVariant,
} from '../../../web/src/components/settings/users-table.js';

describe('roleVariant', () => {
	it('maps roles to badge variants', () => {
		expect(roleVariant('superadmin')).toBe('destructive');
		expect(roleVariant('admin')).toBe('default');
		expect(roleVariant('member')).toBe('secondary');
		expect(roleVariant('anything-else')).toBe('secondary');
	});
});

describe('describeMemberRow', () => {
	it('surfaces both the account role and the per-org role independently', () => {
		const summary = describeMemberRow({ globalRole: 'member', role: 'admin', isGuest: false });
		expect(summary.accountRole).toBe('member');
		expect(summary.orgRole).toBe('admin');
	});

	it('marks cross-home accounts as guests', () => {
		expect(describeMemberRow({ globalRole: 'member', role: 'member', isGuest: true }).isGuest).toBe(
			true,
		);
	});

	it('defaults isGuest to false when the field is absent', () => {
		expect(describeMemberRow({ globalRole: 'admin', role: 'admin' }).isGuest).toBe(false);
	});

	it('flags global superadmins as manage-via-CLI only', () => {
		expect(describeMemberRow({ globalRole: 'superadmin', role: 'admin' }).manageViaCli).toBe(true);
		expect(describeMemberRow({ globalRole: 'admin', role: 'admin' }).manageViaCli).toBe(false);
	});
});
