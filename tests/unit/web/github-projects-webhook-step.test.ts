/**
 * Tests for GitHubProjectsWebhookAdapter (issue #1 fix).
 *
 * GitHub Projects webhooks are set up manually, but the story differs by owner
 * type. The prior copy claimed as a blanket platform fact that "CASCADE cannot
 * create them programmatically" — false for org-owned projects, where
 * `projects_v2_item` is a valid org-hook event creatable via the GitHub API.
 * The adapter now scopes its banner + instructions to `state.githubProjectsOwnerType`:
 *
 *  - organization → org-settings instructions, no "cannot create programmatically" claim
 *  - user → the genuine limitation (no webhook API/settings for user-owned projects)
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock ProjectSecretField — it uses `useQueryClient` which pulls React from
// web/node_modules (a different instance than the root-aliased React the test
// env uses), causing a null-context crash during SSR. The stub renders a
// deterministic `<div>` preserving the props we assert on.
vi.mock('../../../web/src/components/projects/project-secret-field.js', () => ({
	ProjectSecretField: (props: {
		projectId: string;
		envVarKey: string;
		label: string;
		description?: string;
		placeholder?: string;
	}) =>
		createElement(
			'div',
			{
				'data-component': 'ProjectSecretField',
				'data-env-var-key': props.envVarKey,
				'data-project-id': props.projectId,
			},
			createElement('label', null, props.label),
			createElement('input', { type: 'password', placeholder: props.placeholder ?? '' }),
		),
}));

import {
	GitHubProjectsWebhookAdapter,
	normalizeGitHubProjectsActiveWebhooks,
} from '../../../web/src/components/projects/pm-providers/github-projects/webhook-step.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(ownerType: 'user' | 'organization'): WizardState {
	return { githubProjectsOwnerType: ownerType } as WizardState;
}

function makeProviderHooks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		webhookUrl: 'https://router.example.com/github-projects/webhook',
		projectIdForSecret: 'proj-123',
		webhookSecretCredential: undefined,
		callbackBaseUrl: 'https://router.example.com',
		activeGithubProjectsWebhooks: [],
		webhooksLoading: false,
		createGithubProjectsWebhook: () => {},
		createLoading: false,
		createError: undefined,
		deleteGithubProjectsWebhook: () => {},
		deleteLoading: false,
		...overrides,
	};
}

function render(
	ownerType: 'user' | 'organization',
	hookOverrides: Record<string, unknown> = {},
): string {
	return renderToStaticMarkup(
		createElement(GitHubProjectsWebhookAdapter, {
			state: makeState(ownerType),
			dispatch: () => {},
			providerHooks: makeProviderHooks(hookOverrides),
		}),
	);
}

describe('GitHubProjectsWebhookAdapter', () => {
	it('renders the shared WebhookUrlDisplayStep with the webhook URL', () => {
		const html = render('organization');
		expect(html).toContain('data-step-component="webhook-url-display"');
		expect(html).toContain('https://router.example.com/github-projects/webhook');
	});

	it('renders a ProjectSecretField bound to GITHUB_WEBHOOK_SECRET', () => {
		const html = render('organization');
		expect(html).toContain('data-env-var-key="GITHUB_WEBHOOK_SECRET"');
		expect(html).toContain('Webhook Signing Secret');
	});

	it('does not render the ProjectSecretField when projectIdForSecret is empty', () => {
		const html = render('organization', { projectIdForSecret: '' });
		expect(html).not.toContain('Webhook Signing Secret');
	});

	it('shows an owner-appropriate info banner title', () => {
		// Org owners can create programmatically, so the banner is not "Manual … Required".
		expect(render('organization')).toContain('Webhook Setup');
		expect(render('organization')).not.toContain('Manual Webhook Setup Required');
		expect(render('user')).toContain('Manual Webhook Setup Required');
	});

	it('never claims CASCADE cannot create webhooks programmatically (the removed false blanket claim)', () => {
		expect(render('organization')).not.toContain('cannot create them programmatically');
		expect(render('user')).not.toContain('cannot create them programmatically');
	});

	it('for org owners: points at organization settings and omits the user-only limitation', () => {
		const html = render('organization');
		expect(html).toContain('organization');
		// Org webhooks are creatable via the API — the copy must acknowledge that
		// rather than assert a platform prohibition.
		expect(html).toContain('created via the GitHub API');
		expect(html).not.toContain('no create-webhook API');
	});

	it('for user owners: states the genuine no-webhook-API limitation for user-owned projects', () => {
		const html = render('user');
		expect(html).toContain('no create-webhook API');
		expect(html).toContain('projects_v2_item');
	});

	it('for org owners: renders programmatic Create button + active-webhooks list', () => {
		const html = render('organization');
		expect(html).toContain('data-action="create-webhook"');
		expect(html).toContain('data-section="active-webhooks"');
	});

	it('for org owners: renders a delete button for each active webhook', () => {
		const html = render('organization', {
			activeGithubProjectsWebhooks: [
				{ id: '42', url: 'https://router.example.com/github-projects/webhook', active: true },
			],
		});
		expect(html).toContain('data-action="delete-webhook"');
		expect(html).toContain('data-webhook-id="42"');
	});

	it('for user owners: does NOT render the programmatic Create/list UI (no webhook API)', () => {
		const html = render('user');
		expect(html).not.toContain('data-action="create-webhook"');
		expect(html).not.toContain('data-section="active-webhooks"');
	});

	it('surfaces a create error when present (org owners)', () => {
		const html = render('organization', { createError: 'admin:org_hook scope required' });
		expect(html).toContain('admin:org_hook scope required');
	});
});

describe('normalizeGitHubProjectsActiveWebhooks', () => {
	it('keeps only CASCADE github-projects hooks and drops unrelated org hooks', () => {
		const active = normalizeGitHubProjectsActiveWebhooks({
			githubProjects: [
				{ id: 1, active: true, config: { url: 'https://r.example.com/github-projects/webhook' } },
				{ id: 2, active: false, config: { url: 'https://other.example.com/some/thing' } },
				{ id: 3, active: true, config: {} },
			],
		});
		expect(active).toEqual([
			{ id: '1', url: 'https://r.example.com/github-projects/webhook', active: true },
		]);
	});

	it('returns [] for missing data', () => {
		expect(normalizeGitHubProjectsActiveWebhooks(undefined)).toEqual([]);
	});
});
