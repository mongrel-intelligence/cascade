import { createGadgetClass } from '../shared/gadgetFactory.js';
import { updateWorkItem } from './core/updateWorkItem.js';
import { updateWorkItemDef } from './definitions.js';

export const UpdateWorkItem = createGadgetClass(updateWorkItemDef, async (params) => {
	return updateWorkItem({
		workItemId: params.workItemId as string,
		title: params.title as string | undefined,
		description: params.description as string | undefined,
		addLabelIds: params.addLabelIds as string[] | undefined,
	});
});
