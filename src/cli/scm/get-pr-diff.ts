import { getPRDiff } from '../../gadgets/github/core/getPRDiff.js';
import { getPRDiffDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getPRDiffDef, async (params) => {
	return getPRDiff(params.owner as string, params.repo as string, params.prNumber as number);
});
