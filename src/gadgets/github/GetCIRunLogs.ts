import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getCIRunLogs } from './core/getCIRunLogs.js';
import { getCIRunLogsDef } from './definitions.js';

export const GetCIRunLogs = createGadgetClass(getCIRunLogsDef, async (params) => {
	return getCIRunLogs(params.owner as string, params.repo as string, params.ref as string);
});
