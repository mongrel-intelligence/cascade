/**
 * Tests for the membership-based active-org switcher (spec 021 plan 4).
 *
 * Covers the pure decision helpers plus the presentational `OrgSwitcherView`,
 * which is built from SSR-safe primitives (`NativeSelect`) so it renders under
 * `renderToStaticMarkup` in the node test environment. The hook-wired container
 * (`OrgSwitcher`) is intentionally not rendered here.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
	type MyOrg,
	OrgSwitcherView,
	resolveActiveOrgName,
	shouldShowOrgSwitcher,
} from '../../../web/src/components/layout/org-switcher.js';

const acme: MyOrg = { id: 'org-a', name: 'Acme', role: 'admin' };
const beta: MyOrg = { id: 'org-b', name: 'Beta', role: 'member' };

describe('shouldShowOrgSwitcher', () => {
	it('hides the switcher for zero or one membership (inert, spec AC #9)', () => {
		expect(shouldShowOrgSwitcher([])).toBe(false);
		expect(shouldShowOrgSwitcher([acme])).toBe(false);
	});

	it('shows the switcher once the user belongs to more than one org', () => {
		expect(shouldShowOrgSwitcher([acme, beta])).toBe(true);
	});
});

describe('resolveActiveOrgName', () => {
	it('prefers the org matched by the active id', () => {
		expect(resolveActiveOrgName([acme, beta], 'org-b', 'fallback')).toBe('Beta');
	});

	it('falls back to the sole membership when nothing matches the active id', () => {
		expect(resolveActiveOrgName([acme], 'org-x', 'fallback')).toBe('Acme');
	});

	it('falls back to the supplied name when there is no match and not exactly one org', () => {
		expect(resolveActiveOrgName([], null, 'Home Org')).toBe('Home Org');
		expect(resolveActiveOrgName([acme, beta], 'org-x', 'Home Org')).toBe('Home Org');
	});

	it('returns null when there is nothing to show', () => {
		expect(resolveActiveOrgName([], null, null)).toBeNull();
	});
});

describe('OrgSwitcherView — multi-org', () => {
	it('renders a switcher with an option per org and marks the active org', () => {
		const html = renderToStaticMarkup(
			createElement(OrgSwitcherView, {
				orgs: [acme, beta],
				activeOrgId: 'org-a',
				fallbackName: null,
				onSwitch: () => {},
			}),
		);
		expect(html).toContain('data-mode="switcher"');
		expect(html).toContain('data-active-org-id="org-a"');
		expect(html).toContain('aria-label="Switch organization"');
		expect(html).toContain('value="org-a"');
		expect(html).toContain('value="org-b"');
		expect(html).toContain('Acme');
		expect(html).toContain('Beta');
	});

	it('disables the select while a switch is pending', () => {
		const html = renderToStaticMarkup(
			createElement(OrgSwitcherView, {
				orgs: [acme, beta],
				activeOrgId: 'org-a',
				fallbackName: null,
				pending: true,
				onSwitch: () => {},
			}),
		);
		expect(html).toContain('disabled');
	});
});

describe('OrgSwitcherView — single / zero org (inert banner)', () => {
	it('renders the inert banner with the active org name for a single membership', () => {
		const html = renderToStaticMarkup(
			createElement(OrgSwitcherView, {
				orgs: [acme],
				activeOrgId: 'org-a',
				fallbackName: null,
				onSwitch: () => {},
			}),
		);
		expect(html).toContain('data-mode="static"');
		expect(html).not.toContain('data-mode="switcher"');
		expect(html).toContain('Acme');
	});

	it('uses the fallback name when there are no memberships yet (loading)', () => {
		const html = renderToStaticMarkup(
			createElement(OrgSwitcherView, {
				orgs: [],
				activeOrgId: null,
				fallbackName: 'Home Org',
				onSwitch: () => {},
			}),
		);
		expect(html).toContain('data-mode="static"');
		expect(html).toContain('Home Org');
	});

	it('does not invoke onSwitch during a pure render', () => {
		const onSwitch = vi.fn();
		renderToStaticMarkup(
			createElement(OrgSwitcherView, {
				orgs: [acme, beta],
				activeOrgId: 'org-a',
				fallbackName: null,
				onSwitch,
			}),
		);
		expect(onSwitch).not.toHaveBeenCalled();
	});
});
