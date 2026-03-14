import { createGadgetClass } from '../shared/gadgetFactory.js';
import { deleteChecklistItem } from './core/deleteChecklistItem.js';
import { pmDeleteChecklistItemDef } from './definitions.js';

export const PMDeleteChecklistItem = createGadgetClass(pmDeleteChecklistItemDef, async (params) => {
	return deleteChecklistItem(params.workItemId as string, params.checkItemId as string);
});
