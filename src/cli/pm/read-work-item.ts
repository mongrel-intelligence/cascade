import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import { readWorkItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(readWorkItemDef, async (params) => {
	return readWorkItem(params.workItemId as string, params.includeComments as boolean | undefined);
});
