import { getBaseBranch, recordPRCreation } from '../sessionState.js';
import { createGadgetClass } from '../shared/gadgetFactory.js';
import { createPR } from './core/createPR.js';
import { createPRDef } from './definitions.js';

export const CreatePR = createGadgetClass(createPRDef, async (params) => {
	const result = await createPR({
		title: params.title as string,
		body: params.body as string,
		head: params.head as string,
		base: getBaseBranch(),
		draft: params.draft as boolean | undefined,
		commit: params.commit as boolean | undefined,
		commitMessage: params.commitMessage as string | undefined,
		push: params.push as boolean | undefined,
	});

	recordPRCreation(result.prUrl);

	if (result.alreadyExisted) {
		return `PR already exists for this branch: #${result.prNumber} — ${result.prUrl}`;
	}

	const draftLabel = (params.draft as boolean | undefined) ? ' (draft)' : '';
	return `PR #${result.prNumber} created successfully${draftLabel}: ${result.prUrl}`;
});
