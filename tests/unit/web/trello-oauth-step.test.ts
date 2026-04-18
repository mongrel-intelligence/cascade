/**
 * Tests for TrelloOAuthStep (plan 011/2 task 2).
 *
 * The Trello-specific `kind: 'custom'` credentials step. Replaces the
 * legacy `TrelloCredentialsStep` in `pm-wizard-trello-steps.tsx`. Uses
 * `window.open` + manual-token fallback — intrinsically provider-specific,
 * so it stays as a custom step rather than feeding the shared credentials
 * component.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrelloOAuthStep } from '../../../web/src/components/projects/pm-providers/trello/oauth-step.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState> = {}): WizardState {
	return {
		trelloApiKey: '',
		trelloToken: '',
		isEditing: false,
		hasStoredCredentials: false,
		...overrides,
	} as WizardState;
}

describe('TrelloOAuthStep', () => {
	it('renders the API Key input', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState(),
				dispatch: () => {},
			}),
		);
		expect(html).toContain('id="trello-api-key"');
	});

	it('renders the Authorize button (disabled when no API key yet)', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState(),
				dispatch: () => {},
			}),
		);
		expect(html).toContain('data-action="trello-oauth-start"');
		// Match the full <button ...> tag so attribute order doesn't matter.
		const buttonTag = html.match(/<button[^>]*data-action="trello-oauth-start"[^>]*>/)?.[0];
		expect(buttonTag).toBeDefined();
		// React renders boolean `disabled` attribute as `disabled=""`.
		// (Note: Tailwind class names like `disabled:pointer-events-none` would
		// match a bare /disabled/ — pin the attribute form specifically.)
		expect(buttonTag).toMatch(/\sdisabled=""/);
	});

	it('enables the Authorize button once an API key is present', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState({ trelloApiKey: 'abc123' }),
				dispatch: () => {},
			}),
		);
		const buttonTag = html.match(/<button[^>]*data-action="trello-oauth-start"[^>]*>/)?.[0];
		expect(buttonTag).toBeDefined();
		expect(buttonTag).not.toMatch(/\sdisabled=""/);
	});

	it('shows "Token set" indicator when trelloToken is populated', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState({ trelloApiKey: 'abc', trelloToken: 'tok' }),
				dispatch: () => {},
			}),
		);
		expect(html).toContain('Token set');
	});

	it('renders a "Credentials stored" banner in edit mode with stored creds and no new input', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState({
					isEditing: true,
					hasStoredCredentials: true,
					trelloApiKey: '',
				}),
				dispatch: () => {},
			}),
		);
		expect(html).toContain('Credentials stored');
	});

	it('renders the manual-token input inside <details>', () => {
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState({ trelloApiKey: 'abc' }),
				dispatch: () => {},
			}),
		);
		expect(html).toContain('id="trello-token-manual"');
	});

	it('reflects the current trelloApiKey / trelloToken via SSR value attrs', () => {
		// The dispatch wiring is typechecked at compile time (onChange prop's
		// signature). SSR confirms the input `value` attributes reflect state
		// — enough to guard against accidental regressions.
		const html = renderToStaticMarkup(
			createElement(TrelloOAuthStep, {
				state: makeState({ trelloApiKey: 'my-key', trelloToken: 'my-tok' }),
				dispatch: () => {},
			}),
		);
		expect(html).toMatch(/id="trello-api-key"[^>]*value="my-key"/);
		expect(html).toMatch(/id="trello-token-manual"[^>]*value="my-tok"/);
	});
});
