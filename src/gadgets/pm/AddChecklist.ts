import { createGadgetClass } from '../shared/gadgetFactory.js';
import { addChecklist, type ChecklistItemInput } from './core/addChecklist.js';
import { addChecklistDef } from './definitions.js';

export const AddChecklist = createGadgetClass(addChecklistDef, async (params) => {
	return addChecklist({
		workItemId: params.workItemId as string,
		checklistName: params.checklistName as string,
		items: params.item as ChecklistItemInput[],
	});
});
