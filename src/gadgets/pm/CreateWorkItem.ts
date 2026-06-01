import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { createWorkItem } from './core/createWorkItem.js';
import { createWorkItemDef } from './definitions.js';

export const CreateWorkItem = createGadgetClass(createWorkItemDef, async (params) => {
	try {
		const result = await createWorkItem({
			containerId: params.containerId as string,
			title: params.title as string,
			description: params.description as string | undefined,
		});
		return `Work item created successfully: "${result.title}" [id: ${result.id}] - ${result.url}`;
	} catch (error) {
		return formatGadgetError('creating work item', error);
	}
});
