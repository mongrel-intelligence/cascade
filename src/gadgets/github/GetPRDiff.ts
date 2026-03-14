import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getPRDiff } from './core/getPRDiff.js';
import { getPRDiffDef } from './definitions.js';

export const GetPRDiff = createGadgetClass(getPRDiffDef, async (params) => {
	return getPRDiff(params.owner as string, params.repo as string, params.prNumber as number);
});
