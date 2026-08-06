import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getMRDiff } from './core/getMRDiff.js';
import { getMRDiffDef } from './definitions.js';

export const GetMRDiff = createGadgetClass(getMRDiffDef, async (params) => {
	return getMRDiff(params.projectPath as string, params.mrIid as number);
});
