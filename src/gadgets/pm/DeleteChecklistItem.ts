import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { deleteChecklistItem } from './core/deleteChecklistItem.js';
import { pmDeleteChecklistItemDef } from './definitions.js';

export const PMDeleteChecklistItem = createGadgetClass(pmDeleteChecklistItemDef, async (params) => {
	try {
		const result = await deleteChecklistItem(
			params.workItemId as string,
			params.checkItemId as string,
		);
		return `Checklist item ${result.checkItemId} deleted from ${result.workItemUrl}`;
	} catch (error) {
		return formatGadgetError('deleting checklist item', error);
	}
});
