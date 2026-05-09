import { reportFriction } from '../../gadgets/pm/core/reportFriction.js';
import { reportFrictionDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(reportFrictionDef, async (params) => {
	return reportFriction({
		summary: params.summary as string,
		details: params.details as string,
		category: params.category as never,
		severity: params.severity as never,
		whileDoing: params.whileDoing as string | undefined,
	});
});
