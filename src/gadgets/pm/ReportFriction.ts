import { createGadgetClass } from '../shared/gadgetFactory.js';
import { reportFriction } from './core/reportFriction.js';
import { reportFrictionDef } from './definitions.js';

export const ReportFriction = createGadgetClass(reportFrictionDef, async (params) => {
	const result = await reportFriction({
		summary: params.summary as string,
		details: params.details as string,
		category: params.category as never,
		severity: params.severity as never,
		whileDoing: params.whileDoing as string | undefined,
	});

	if (result.status === 'filed') {
		return `Friction report filed: ${result.workItemUrl ?? result.workItemId}`;
	}
	return `${result.status}: ${result.message}`;
});
