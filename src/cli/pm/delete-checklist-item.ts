import { deleteChecklistItem } from '../../gadgets/pm/core/deleteChecklistItem.js';
import { pmDeleteChecklistItemDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(pmDeleteChecklistItemDef, async (params) => {
	return deleteChecklistItem(params.workItemId as string, params.checkItemId as string);
});
