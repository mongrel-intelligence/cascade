import { TaskCompletionSignal } from 'llmist';
import { validateFinish, writePushedChangesSidecar } from './session/core/finish.js';
import { finishDef } from './session/definitions.js';
import { PUSHED_CHANGES_SIDECAR_ENV_VAR } from './sessionState.js';
import { getSessionState } from './sessionState.js';
import { createGadgetClass } from './shared/gadgetFactory.js';

export const Finish = createGadgetClass(finishDef, async (params) => {
	const state = getSessionState();

	const result = await validateFinish({
		agentType: state.agentType,
		prCreated: state.prCreated,
		reviewSubmitted: state.reviewSubmitted,
		hooks: state.hooks,
		initialHeadSha: state.initialHeadSha,
	});

	if (!result.valid) {
		throw new Error(result.error);
	}

	if (state.hooks.requiresPushedChanges) {
		writePushedChangesSidecar(process.env[PUSHED_CHANGES_SIDECAR_ENV_VAR]);
	}

	throw new TaskCompletionSignal(params.comment as string);
});
