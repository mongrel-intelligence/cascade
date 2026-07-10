/**
 * JIRA credentials step — API-token-with-scopes selector (MNG-1744).
 *
 * The JiraCredentialsAdapter (first step of the JIRA wizard) renders a
 * basic/scoped auth-type selector above the credential inputs. The choice
 * drives host routing (site URL for `basic`, api.atlassian.com gateway for
 * `scoped`) and is threaded into the verify credential bag as `auth_type`.
 *
 * These tests render the adapter to static markup (SSR-safe shadcn
 * primitives) and assert the selector + helper text, and verify the
 * segmented control is wired to `SET_JIRA_AUTH_TYPE`.
 */

import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import type { ProviderWizardStepProps } from '../../../web/src/components/projects/pm-providers/types.js';
import type {
	WizardAction,
	WizardState,
} from '../../../web/src/components/projects/pm-wizard-state.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

const CredentialsComponent = jiraProviderWizard.steps.find((s) => s.id === 'jira-credentials')
	?.Component as (props: ProviderWizardStepProps) => ReactElement;

function jiraState(overrides: Partial<WizardState> = {}): WizardState {
	return { ...createInitialState(), provider: 'jira', ...overrides };
}

function renderAdapter(
	state: WizardState,
	dispatch: (action: WizardAction) => void = () => {},
): string {
	return renderToStaticMarkup(createElement(CredentialsComponent, { state, dispatch }));
}

/** Recursively collect every React element in a rendered tree. */
function collectElements(node: unknown, out: ReactElement[] = []): ReactElement[] {
	if (Array.isArray(node)) {
		for (const child of node) collectElements(child, out);
		return out;
	}
	if (isValidElement(node)) {
		out.push(node);
		const props = node.props as { children?: unknown };
		if (props?.children !== undefined) collectElements(props.children, out);
	}
	return out;
}

describe('JiraCredentialsAdapter auth-type selector (MNG-1744)', () => {
	it('renders both basic and scoped options', () => {
		const html = renderAdapter(jiraState());
		expect(html).toContain('data-auth-type-selector="jira"');
		expect(html).toContain('data-auth-type-option="basic"');
		expect(html).toContain('data-auth-type-option="scoped"');
		expect(html).toContain('API token');
		expect(html).toContain('API token with scopes');
	});

	it('still renders the base_url + email + api_token credential inputs', () => {
		const html = renderAdapter(jiraState());
		expect(html).toContain('data-role="base_url"');
		expect(html).toContain('data-role="email"');
		expect(html).toContain('data-role="api_token"');
	});

	it('reflects the basic default in the selected option + helper text', () => {
		const html = renderAdapter(jiraState());
		expect(html).toContain('data-auth-type-hint="basic"');
		// basic helper text mentions the classic site URL routing.
		expect(html).toContain('site URL');
		// basic is selected, scoped is not.
		expect(html).toMatch(
			/data-auth-type-option="basic"[^>]*data-selected="true"|data-selected="true"[^>]*data-auth-type-option="basic"/,
		);
		expect(html).toMatch(
			/data-auth-type-option="scoped"[^>]*data-selected="false"|data-selected="false"[^>]*data-auth-type-option="scoped"/,
		);
	});

	it('reflects the scoped selection in the helper text (api.atlassian.com gateway)', () => {
		const html = renderAdapter(jiraState({ jiraAuthType: 'scoped' }));
		expect(html).toContain('data-auth-type-hint="scoped"');
		expect(html).toContain('api.atlassian.com');
		expect(html).toMatch(
			/data-auth-type-option="scoped"[^>]*data-selected="true"|data-selected="true"[^>]*data-auth-type-option="scoped"/,
		);
	});

	it('dispatches SET_JIRA_AUTH_TYPE with the clicked option value', () => {
		const dispatch = vi.fn();
		const tree = CredentialsComponent({ state: jiraState(), dispatch });
		const elements = collectElements(tree);

		const scoped = elements.find(
			(el) => (el.props as Record<string, unknown>)['data-auth-type-option'] === 'scoped',
		);
		expect(scoped).toBeDefined();
		(scoped?.props as { onClick: () => void }).onClick();
		expect(dispatch).toHaveBeenCalledWith({ type: 'SET_JIRA_AUTH_TYPE', value: 'scoped' });

		const basic = elements.find(
			(el) => (el.props as Record<string, unknown>)['data-auth-type-option'] === 'basic',
		);
		(basic?.props as { onClick: () => void }).onClick();
		expect(dispatch).toHaveBeenCalledWith({ type: 'SET_JIRA_AUTH_TYPE', value: 'basic' });
	});
});
