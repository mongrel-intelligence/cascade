import { moveWorkItem } from '../../gadgets/pm/core/moveWorkItem.js';
import { moveWorkItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(moveWorkItemDef, async (params) => {
	return moveWorkItem({
		workItemId: params.workItemId as string,
		destination: params.destination as string,
	});
});
