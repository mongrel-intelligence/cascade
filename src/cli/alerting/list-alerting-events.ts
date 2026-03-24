import { listSentryEvents } from '../../gadgets/sentry/core/listSentryEvents.js';
import { listAlertingEventsDef } from '../../gadgets/sentry/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(listAlertingEventsDef, async (params) => {
	return listSentryEvents(
		params.organizationId as string,
		params.issueId as string,
		params.limit as number | undefined,
	);
});
