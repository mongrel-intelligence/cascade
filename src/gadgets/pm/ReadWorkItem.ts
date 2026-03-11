import { createGadgetClass } from '../shared/gadgetFactory.js';
import { readWorkItem } from './core/readWorkItem.js';
import { readWorkItemDef } from './definitions.js';

export const ReadWorkItem = createGadgetClass(readWorkItemDef, async (params) => {
	return readWorkItem(params.workItemId as string, params.includeComments as boolean | undefined);
});
