import { createGadgetClass } from '../shared/gadgetFactory.js';
import { listSentryEvents } from './core/listSentryEvents.js';
import { listAlertingEventsDef } from './definitions.js';

export const ListAlertingEvents = createGadgetClass(listAlertingEventsDef, async (params) => {
	return listSentryEvents(
		params.organizationId as string,
		params.issueId as string,
		params.limit as number | undefined,
	);
});
