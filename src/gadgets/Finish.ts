import { Gadget, TaskCompletionSignal, z } from 'llmist';
import { validateFinish } from './session/core/finish.js';
import { getSessionState } from './sessionState.js';

export class Finish extends Gadget({
	name: 'Finish',
	maxConcurrent: 1,
	description:
		'Call this gadget when you have completed all tasks and want to end the session. This should be your final gadget call.',
	schema: z.object({
		comment: z.string().min(1).describe('A brief summary of what was accomplished'),
	}),
	examples: [
		{
			params: { comment: 'Created PR with all requested changes and tests passing' },
			output: 'Session ended: Created PR with all requested changes and tests passing',
			comment: 'End session after completing all work',
		},
	],
}) {
	override async execute(params: this['params']): Promise<never> {
		const state = getSessionState();

		const result = await validateFinish({
			agentType: state.agentType,
			prCreated: state.prCreated,
			reviewSubmitted: state.reviewSubmitted,
		});

		if (!result.valid) {
			throw new Error(result.error);
		}

		throw new TaskCompletionSignal(params.comment);
	}
}
