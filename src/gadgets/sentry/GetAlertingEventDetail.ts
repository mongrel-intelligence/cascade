import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getSentryEventDetail } from './core/getSentryEventDetail.js';
import { getAlertingEventDetailDef } from './definitions.js';

export const GetAlertingEventDetail = createGadgetClass(
	getAlertingEventDetailDef,
	async (params) => {
		return getSentryEventDetail(
			params.organizationId as string,
			params.issueId as string,
			params.eventId as string | undefined,
		);
	},
);
