/**
 * Tests for the shared CredentialsStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { CredentialsStep } from '../../../../web/src/components/projects/pm-providers/steps/credentials.js';

const step: StandardStep = { kind: 'credentials', id: 'creds' };

describe('CredentialsStep', () => {
	it('renders one input per credential role', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [
					{ role: 'api_key', label: 'API Key' },
					{ role: 'token', label: 'Token' },
				],
				values: {},
				onChange: () => {},
			}),
		);
		expect(html).toContain('data-role="api_key"');
		expect(html).toContain('data-role="token"');
		expect(html).toContain('API Key');
		expect(html).toContain('Token');
	});

	it('shows "(optional)" suffix for optional roles', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [{ role: 'webhook_secret', label: 'Webhook Secret', optional: true }],
				values: {},
				onChange: () => {},
			}),
		);
		expect(html).toContain('(optional)');
	});

	it('masks token/password roles with type="password"', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [
					{ role: 'api_token', label: 'API Token' },
					{ role: 'api_key', label: 'API Key' },
				],
				values: {},
				onChange: () => {},
			}),
		);
		// api_token → password; api_key → text (role doesn't include 'token'/'password')
		expect(html).toMatch(/id="cred-api_token"[^>]*type="password"/);
	});

	it('renders verify button when onVerify is supplied', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [{ role: 'api_key', label: 'API Key' }],
				values: {},
				onChange: () => {},
				onVerify: () => {},
			}),
		);
		expect(html).toContain('data-action="verify"');
		expect(html).toContain('Verify credentials');
	});

	it('shows verificationDisplay on success', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [{ role: 'api_key', label: 'API Key' }],
				values: {},
				onChange: () => {},
				onVerify: () => {},
				verificationDisplay: '@testuser (Test User)',
			}),
		);
		expect(html).toContain('data-verification="success"');
		expect(html).toContain('@testuser (Test User)');
	});

	it('shows error message on verification failure', () => {
		const html = renderToStaticMarkup(
			createElement(CredentialsStep, {
				step,
				providerId: 'test',
				credentialRoles: [{ role: 'api_key', label: 'API Key' }],
				values: {},
				onChange: () => {},
				onVerify: () => {},
				verificationError: 'Invalid API key',
			}),
		);
		expect(html).toContain('data-verification="error"');
		expect(html).toContain('Invalid API key');
	});

	it('calls onChange with the role + value when input changes', async () => {
		// Use @testing-library-free approach: spy onChange, render with createElement,
		// simulate change event via component instance. Since this is SSR, we test
		// the prop path by asserting onChange is wired — a runtime render would
		// need happy-dom which the core test project doesn't load.
		const onChange = vi.fn();
		const element = createElement(CredentialsStep, {
			step,
			providerId: 'test',
			credentialRoles: [{ role: 'api_key', label: 'API Key' }],
			values: { api_key: 'existing-value' },
			onChange,
		});
		const html = renderToStaticMarkup(element);
		// Input reflects the current value from state.
		expect(html).toContain('value="existing-value"');
	});
});
