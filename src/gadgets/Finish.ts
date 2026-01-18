import { Gadget, TaskCompletionSignal, z } from 'llmist';

export class Finish extends Gadget({
	name: 'Finish',
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
	override execute(params: this['params']): never {
		throw new TaskCompletionSignal(params.comment);
	}
}
