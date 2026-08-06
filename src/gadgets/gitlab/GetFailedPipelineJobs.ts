import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getFailedPipelineJobs } from './core/getFailedPipelineJobs.js';
import { getFailedPipelineJobsDef } from './definitions.js';

export const GetFailedPipelineJobs = createGadgetClass(getFailedPipelineJobsDef, async (params) => {
	return getFailedPipelineJobs(params.projectPath as string, params.pipelineId as number);
});
