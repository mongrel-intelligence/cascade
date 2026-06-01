import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { moveWorkItem } from './core/moveWorkItem.js';
import { moveWorkItemDef } from './definitions.js';

export const MoveWorkItem = createGadgetClass(moveWorkItemDef, async (params) => {
	try {
		const result = await moveWorkItem({
			workItemId: params.workItemId as string,
			destination: params.destination as string,
			expectedSourceState: params.expectedSourceState as string | undefined,
		});

		switch (result.status) {
			case 'moved':
				return `Work item ${result.id} moved to ${result.destination} successfully`;
			case 'noop':
				return result.message ?? `Work item ${result.id} already in destination state — no-op`;
			case 'aborted':
				return result.message ?? `Aborted move of work item ${result.id}`;
		}
	} catch (error) {
		return formatGadgetError('moving work item', error);
	}
});
