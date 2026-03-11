import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getPRComments } from './core/getPRComments.js';
import { getPRCommentsDef } from './definitions.js';

export const GetPRComments = createGadgetClass(getPRCommentsDef, async (params) => {
	return getPRComments(params.owner as string, params.repo as string, params.prNumber as number);
});
