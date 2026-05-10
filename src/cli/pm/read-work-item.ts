import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import { readWorkItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

function normalizeWorkItemId(workItemId: string): string {
	if (workItemId.length >= 2) {
		const first = workItemId[0];
		const last = workItemId.at(-1);
		if ((first === '"' || first === "'") && first === last) {
			return workItemId.slice(1, -1);
		}
	}
	return workItemId;
}

export default createCLICommand(readWorkItemDef, async (params) => {
	return readWorkItem(
		normalizeWorkItemId(params.workItemId as string),
		params.includeComments as boolean | undefined,
	);
});
