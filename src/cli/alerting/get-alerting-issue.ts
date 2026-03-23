import { getSentryIssue } from '../../gadgets/sentry/core/getSentryIssue.js';
import { getAlertingIssueDef } from '../../gadgets/sentry/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getAlertingIssueDef, async (params) => {
	return getSentryIssue(params.organizationId as string, params.issueId as string);
});
