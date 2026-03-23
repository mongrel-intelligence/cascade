import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getSentryIssue } from './core/getSentryIssue.js';
import { getAlertingIssueDef } from './definitions.js';

export const GetAlertingIssue = createGadgetClass(getAlertingIssueDef, async (params) => {
	return getSentryIssue(params.organizationId as string, params.issueId as string);
});
