import { updateWorkItem } from '../../gadgets/pm/core/updateWorkItem.js';
import { updateWorkItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(updateWorkItemDef, async (params) => {
	return updateWorkItem({
		workItemId: params.workItemId as string,
		title: params.title as string | undefined,
		description: params.description as string | undefined,
		addLabelIds: params.addLabelIds as string[] | undefined,
	});
});
