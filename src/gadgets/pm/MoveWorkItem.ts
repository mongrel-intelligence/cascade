import { createGadgetClass } from '../shared/gadgetFactory.js';
import { moveWorkItem } from './core/moveWorkItem.js';
import { moveWorkItemDef } from './definitions.js';

export const MoveWorkItem = createGadgetClass(moveWorkItemDef, async (params) => {
	return moveWorkItem({
		workItemId: params.workItemId as string,
		destination: params.destination as string,
	});
});
