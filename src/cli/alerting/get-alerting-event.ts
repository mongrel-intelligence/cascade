import { getSentryEventDetail } from '../../gadgets/sentry/core/getSentryEventDetail.js';
import { getAlertingEventDetailDef } from '../../gadgets/sentry/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getAlertingEventDetailDef, async (params) => {
	return getSentryEventDetail(
		params.organizationId as string,
		params.issueId as string,
		params.eventId as string | undefined,
	);
});
