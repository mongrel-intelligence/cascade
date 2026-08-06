import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getPipelineStatus } from './core/getPipelineStatus.js';
import { getPipelineStatusDef } from './definitions.js';

export const GetPipelineStatus = createGadgetClass(getPipelineStatusDef, async (params) => {
	return getPipelineStatus(params.projectPath as string, params.pipelineId as number);
});
