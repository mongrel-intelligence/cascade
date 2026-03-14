import { updateChecklistItem } from '../../gadgets/pm/core/updateChecklistItem.js';
import { pmUpdateChecklistItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(pmUpdateChecklistItemDef, async (params) => {
	return updateChecklistItem(
		params.workItemId as string,
		params.checkItemId as string,
		(params.state as string) === 'complete',
	);
});
