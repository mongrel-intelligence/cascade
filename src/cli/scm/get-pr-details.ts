import { getPRDetails } from '../../gadgets/github/core/getPRDetails.js';
import { getPRDetailsDef } from '../../gadgets/github/definitions.js';
import { getMRDetails } from '../../gadgets/gitlab/core/getMRDetails.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(getPRDetailsDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		return getMRDetails(projectPath, params.prNumber as number);
	}
	return getPRDetails(params.owner as string, params.repo as string, params.prNumber as number);
});
