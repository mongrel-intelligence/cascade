import { createPR } from '../../gadgets/github/core/createPR.js';
import { createPRDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(createPRDef, async (params) => {
	const base = params.base as string | undefined;
	if (!base) {
		throw new Error('--base is required (or set CASCADE_BASE_BRANCH env var)');
	}
	return createPR({
		title: params.title as string,
		body: params.body as string,
		head: params.head as string,
		base,
		draft: params.draft as boolean | undefined,
		commit: params.commit as boolean | undefined,
		commitMessage: params.commitMessage as string | undefined,
		push: params.push as boolean | undefined,
	});
});
