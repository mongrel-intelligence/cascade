import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getMRDetails } from './core/getMRDetails.js';
import { getMRDetailsDef } from './definitions.js';

export const GetMRDetails = createGadgetClass(getMRDetailsDef, async (params) => {
	return getMRDetails(params.projectPath as string, params.mrIid as number);
});
