import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatCheckStatus, getPRChecks } from './core/getPRChecks.js';
import { getPRChecksDef } from './definitions.js';

// Re-export formatCheckStatus for use by synthetic calls
export { formatCheckStatus };

export const GetPRChecks = createGadgetClass(getPRChecksDef, async (params) => {
	return getPRChecks(params.owner as string, params.repo as string, params.prNumber as number);
});
