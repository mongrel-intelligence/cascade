import { createGadgetClass } from '../shared/gadgetFactory.js';
import { updateChecklistItem } from './core/updateChecklistItem.js';
import { pmUpdateChecklistItemDef } from './definitions.js';

export const PMUpdateChecklistItem = createGadgetClass(pmUpdateChecklistItemDef, async (params) => {
	return updateChecklistItem(
		params.workItemId as string,
		params.checkItemId as string,
		(params.state as string) === 'complete',
	);
});
