import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getPRDetails } from './core/getPRDetails.js';
import { getPRDetailsDef } from './definitions.js';

export const GetPRDetails = createGadgetClass(getPRDetailsDef, async (params) => {
	return getPRDetails(params.owner as string, params.repo as string, params.prNumber as number);
});
