import { createGadgetClass } from '../shared/gadgetFactory.js';
import { listWorkItems } from './core/listWorkItems.js';
import { listWorkItemsDef } from './definitions.js';

export const ListWorkItems = createGadgetClass(listWorkItemsDef, async (params) => {
	return listWorkItems(params.containerId as string);
});
