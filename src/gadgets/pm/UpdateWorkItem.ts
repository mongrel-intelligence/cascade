import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { updateWorkItem } from './core/updateWorkItem.js';
import { updateWorkItemDef } from './definitions.js';

export const UpdateWorkItem = createGadgetClass(updateWorkItemDef, async (params) => {
	try {
		const result = await updateWorkItem({
			workItemId: params.workItemId as string,
			title: params.title as string | undefined,
			description: params.description as string | undefined,
			addLabelIds: params.addLabelId as string[] | undefined,
		});

		if (result.status === 'noop') {
			return result.message ?? 'Nothing to update - provide title, description, or labels';
		}

		const updated: string[] = [...result.changedFields];
		if (result.addedLabelIds.length > 0) {
			updated.push(`${result.addedLabelIds.length} label(s)`);
		}
		return `Work item updated: ${updated.join(', ')}`;
	} catch (error) {
		return formatGadgetError('updating work item', error);
	}
});
