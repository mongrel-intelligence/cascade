import { createGadgetClass } from '../shared/gadgetFactory.js';
import { mergeMR } from './core/mergeMR.js';
import { mergeMRDef } from './definitions.js';

export const MergeMR = createGadgetClass(mergeMRDef, async (params) => {
	return mergeMR(
		params.projectPath as string,
		params.mrIid as number,
		params.squash as boolean | undefined,
	);
});
