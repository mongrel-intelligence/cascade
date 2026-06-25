/**
 * Tests for the "add existing account to this org" form (spec 021 plan 4, AC #1).
 *
 * Covers the success-message helper and the presentational `AddToOrgForm`, which
 * is pure + SSR-safe so it renders under `renderToStaticMarkup`. The hook-wired
 * container (`AddToOrgDialog`) is not rendered here.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	AddToOrgForm,
	formatAddToOrgSuccess,
} from '../../../web/src/components/settings/add-to-org-dialog.js';

describe('formatAddToOrgSuccess', () => {
	it('describes a fresh grant', () => {
		expect(
			formatAddToOrgSuccess({ email: 'jane@example.com', role: 'member', alreadyMember: false }),
		).toBe('Added jane@example.com to this organization as member.');
	});

	it('describes an idempotent re-grant as a role update', () => {
		expect(
			formatAddToOrgSuccess({ email: 'jane@example.com', role: 'admin', alreadyMember: true }),
		).toBe("Updated jane@example.com's role to admin in this organization.");
	});
});

const baseProps = {
	email: '',
	role: 'member' as const,
	onEmailChange: () => {},
	onRoleChange: () => {},
	onSubmit: () => {},
	onCancel: () => {},
};

describe('AddToOrgForm', () => {
	it('renders the email field and both role options', () => {
		const html = renderToStaticMarkup(createElement(AddToOrgForm, baseProps));
		expect(html).toContain('data-form="add-to-org"');
		expect(html).toContain('id="add-to-org-email"');
		expect(html).toContain('type="email"');
		expect(html).toContain('value="member"');
		expect(html).toContain('value="admin"');
	});

	it('reflects the current email value', () => {
		const html = renderToStaticMarkup(
			createElement(AddToOrgForm, { ...baseProps, email: 'jane@example.com' }),
		);
		expect(html).toContain('value="jane@example.com"');
	});

	it('surfaces the NOT_FOUND envelope inline', () => {
		const html = renderToStaticMarkup(
			createElement(AddToOrgForm, {
				...baseProps,
				errorMessage:
					'No account exists with this email. Create the user first with `cascade users create`.',
			}),
		);
		expect(html).toContain('data-message="error"');
		expect(html).toContain('No account exists with this email');
	});

	it('shows the success banner when a grant succeeds', () => {
		const html = renderToStaticMarkup(
			createElement(AddToOrgForm, {
				...baseProps,
				successMessage: 'Added jane@example.com to this organization as member.',
			}),
		);
		expect(html).toContain('data-message="success"');
		expect(html).toContain('Added jane@example.com to this organization as member.');
	});

	it('disables the submit button and shows progress while pending', () => {
		const html = renderToStaticMarkup(createElement(AddToOrgForm, { ...baseProps, pending: true }));
		expect(html).toContain('disabled');
		expect(html).toContain('Adding...');
	});
});
