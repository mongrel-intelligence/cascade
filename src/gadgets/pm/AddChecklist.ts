import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { addChecklist, type ChecklistItemInput } from './core/addChecklist.js';
import { addChecklistDef } from './definitions.js';

export const AddChecklist = createGadgetClass(addChecklistDef, async (params) => {
	try {
		const result = await addChecklist({
			workItemId: params.workItemId as string,
			checklistName: params.checklistName as string,
			items: params.item as ChecklistItemInput[],
		});
		return `Checklist "${result.checklistName}" created (id: ${result.checklistId}) with ${result.itemCount} items on ${result.workItemUrl}`;
	} catch (error) {
		return formatGadgetError('adding checklist', error);
	}
});
