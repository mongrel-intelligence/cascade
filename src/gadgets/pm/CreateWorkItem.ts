import { createGadgetClass } from '../shared/gadgetFactory.js';
import { createWorkItem } from './core/createWorkItem.js';
import { createWorkItemDef } from './definitions.js';

export const CreateWorkItem = createGadgetClass(createWorkItemDef, async (params) => {
	return createWorkItem({
		containerId: params.containerId as string,
		title: params.title as string,
		description: params.description as string | undefined,
	});
});
