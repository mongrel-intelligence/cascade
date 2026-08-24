// @vitest-environment jsdom
/**
 * Spec 024 plan 5 — the JIRA routing step must not unmount its value input
 * mid-edit on the EDIT path.
 *
 * Round 1 fixed this for the fresh-add flow via a `selectedKind` view-state:
 * picking a kind from the dropdown seeds it, so clearing the value (which the
 * reducer treats as "no discriminator", dropping `jiraRoutingKind` to '') keeps
 * `shownKind = selectedKind ?? routingKind` non-empty and the input mounted.
 *
 * But the edit flow never touches the dropdown: `buildEditState` hydrates the
 * saved discriminator into `jiraRoutingKind` through a DEFERRED `INIT_EDIT`
 * dispatch (it waits on the credentials query), so `selectedKind` stayed
 * `undefined`. Clearing a saved value then unmounted the input the operator was
 * editing and snapped the dropdown back to None — the exact Round 1 defect,
 * only closed for create.
 *
 * The adapter now seeds `selectedKind` from the hydrated kind via a mount
 * effect. This renders the REAL step Component under jsdom with the reducer
 * driving state, and simulates the deferred hydration with a post-mount
 * dispatch — the timing that made the defect reachable and that a `useState`
 * initializer (which reads the pre-hydration '') would still miss.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect, useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createInitialJiraState,
	type JiraWizardAction,
	jiraWizardReducer,
} from '../../../web/src/components/projects/pm-providers/jira/state.js';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';

const routingStep = jiraProviderWizard.steps.find((s) => s.id === 'jira-routing');
if (!routingStep) throw new Error('jira-routing step is not registered on the wizard');
// The step's Component (`JiraRoutingAdapter`) reached through the wizard
// definition rather than a named export — the same access the reducer-level
// suite uses for `jiraProviderWizard`.
const RoutingAdapter = routingStep.Component;

type HarnessState = ReturnType<typeof createInitialJiraState> & {
	verificationResult: null;
	verifyError: null;
};

const reducer = jiraWizardReducer as unknown as (
	s: HarnessState,
	a: JiraWizardAction,
) => HarnessState;

/**
 * Drives the adapter with the real reducer, dispatching the discriminator
 * AFTER first render so it arrives the way `INIT_EDIT` does — deferred, not as
 * an initial value.
 */
function Harness({
	hydrateKind = '',
	hydrateValue = '',
}: {
	hydrateKind?: '' | 'label' | 'component';
	hydrateValue?: string;
}) {
	const [state, dispatch] = useReducer(reducer, {
		...createInitialJiraState(),
		verificationResult: null,
		verifyError: null,
	});
	// The props are fixed for a given render, so this fires once — mirroring the
	// single deferred INIT_EDIT dispatch, not a value present at first render.
	useEffect(() => {
		if (hydrateKind) {
			dispatch({
				type: 'SET_JIRA_ROUTING_DISCRIMINATOR',
				kind: hydrateKind,
				value: hydrateValue,
			});
		}
	}, [hydrateKind, hydrateValue]);
	return createElement(RoutingAdapter, { state, dispatch } as never);
}

afterEach(cleanup);

describe('JIRA routing step — edit-path value input stability', () => {
	it('keeps the value input mounted when a hydrated discriminator is cleared', async () => {
		render(createElement(Harness, { hydrateKind: 'label', hydrateValue: 'team-be' }));

		// After the deferred hydration + the mount-effect seed, the value input is
		// shown with the saved value.
		const value = (await screen.findByLabelText('Label')) as HTMLInputElement;
		expect(value.value).toBe('team-be');

		// Clearing it drops `jiraRoutingKind` to '' in the reducer — the state that
		// unmounted this very input before the fix.
		fireEvent.change(value, { target: { value: '' } });

		// The input is still there to keep typing in, and the kind dropdown has not
		// snapped back to None.
		expect(screen.getByLabelText('Label')).toBeTruthy();
		expect((screen.getByLabelText('Route by') as HTMLSelectElement).value).toBe('label');
	});

	it('still honours an explicit None selection on a hydrated discriminator', async () => {
		// The seed must not fight the operator: choosing None has to hide the input,
		// or the mount effect would be over-eager and re-show it.
		render(createElement(Harness, { hydrateKind: 'component', hydrateValue: 'Backend' }));
		await screen.findByLabelText('Component');

		fireEvent.change(screen.getByLabelText('Route by'), { target: { value: '' } });

		expect(screen.queryByLabelText('Component')).toBeNull();
		expect((screen.getByLabelText('Route by') as HTMLSelectElement).value).toBe('');
	});
});
