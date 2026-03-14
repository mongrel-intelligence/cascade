import { getPRChecks } from '../../gadgets/github/core/getPRChecks.js';
import { getPRChecksDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getPRChecksDef, async (params) => {
	return getPRChecks(params.owner as string, params.repo as string, params.prNumber as number);
});
