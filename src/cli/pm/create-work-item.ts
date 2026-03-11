import { createWorkItem } from '../../gadgets/pm/core/createWorkItem.js';
import { createWorkItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(createWorkItemDef, async (params) => {
	return createWorkItem({
		containerId: params.containerId as string,
		title: params.title as string,
		description: params.description as string | undefined,
	});
});
