/**
 * Unified ToolDefinition objects for all Session tools.
 *
 * These definitions are the single source of truth for:
 * - Gadget classes (generated via createGadgetClass)
 * - CLI commands (generated via createCLICommand)
 * - JSON Schema manifests (generated via buildManifest)
 */

import type { ToolDefinition } from '../shared/toolDefinition.js';

export const finishDef: ToolDefinition = {
	name: 'Finish',
	description:
		'Call this gadget when you have completed all tasks and want to end the session. This should be your final gadget call.',
	exclusive: true,
	parameters: {
		comment: {
			type: 'string',
			describe: 'A brief summary of what was accomplished',
			required: true,
		},
	},
	examples: [
		{
			params: { comment: 'Created PR with all requested changes and tests passing' },
			output: 'Session ended: Created PR with all requested changes and tests passing',
			comment: 'End session after completing all work',
		},
	],
};
