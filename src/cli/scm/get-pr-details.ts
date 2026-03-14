import { getPRDetails } from '../../gadgets/github/core/getPRDetails.js';
import { getPRDetailsDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getPRDetailsDef, async (params) => {
	return getPRDetails(params.owner as string, params.repo as string, params.prNumber as number);
});
