import { createGadgetClass } from '../shared/gadgetFactory.js';
import { approveMR } from './core/approveMR.js';
import { approveMRDef } from './definitions.js';

export const ApproveMR = createGadgetClass(approveMRDef, async (params) => {
	return approveMR(
		params.projectPath as string,
		params.mrIid as number,
		params.action as 'approve' | 'unapprove',
	);
});
