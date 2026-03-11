import { createPRReview } from '../../gadgets/github/core/createPRReview.js';
import { createPRReviewDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(createPRReviewDef, async (params) => {
	return createPRReview({
		owner: params.owner as string,
		repo: params.repo as string,
		prNumber: params.prNumber as number,
		event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
		body: params.body as string,
		comments: params.comments as Array<{ path: string; line?: number; body: string }> | undefined,
	});
});
