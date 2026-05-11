import { listWorkItems } from '../../gadgets/pm/core/listWorkItems.js';
import { listWorkItemsDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(listWorkItemsDef, async (params) => {
	return listWorkItems({
		containerId: params.containerId as string | undefined,
		status: params.status as string | undefined,
	});
});
