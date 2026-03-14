import { getCIRunLogs } from '../../gadgets/github/core/getCIRunLogs.js';
import { getCIRunLogsDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getCIRunLogsDef, async (params) => {
	return getCIRunLogs(params.owner as string, params.repo as string, params.ref as string);
});
