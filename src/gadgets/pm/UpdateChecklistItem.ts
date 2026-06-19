import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { updateChecklistItem } from './core/updateChecklistItem.js';
import { pmUpdateChecklistItemDef } from './definitions.js';

export const PMUpdateChecklistItem = createGadgetClass(pmUpdateChecklistItemDef, async (params) => {
	try {
		const result = await updateChecklistItem(
			params.workItemId as string,
			params.checkItemId as string,
			(params.state as string) === 'complete',
		);
		const action = result.complete ? 'marked complete' : 'marked incomplete';
		return `Checklist item ${result.checkItemId} ${action} on ${result.workItemUrl}`;
	} catch (error) {
		return formatGadgetError('updating checklist item', error);
	}
});
