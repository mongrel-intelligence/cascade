import { getBaseBranch, recordPRCreation } from '../sessionState.js';
import { createGadgetClass } from '../shared/gadgetFactory.js';
import { createMR } from './core/createMR.js';
import { createMRDef } from './definitions.js';

export const CreateMR = createGadgetClass(createMRDef, async (params) => {
	const result = await createMR({
		title: params.title as string,
		body: params.body as string,
		head: params.head as string,
		base: getBaseBranch(),
		draft: params.draft as boolean | undefined,
		commit: params.commit as boolean | undefined,
		commitMessage: params.commitMessage as string | undefined,
		push: params.push as boolean | undefined,
	});

	recordPRCreation(result.mrUrl);

	if (result.alreadyExisted) {
		return `MR already exists for this branch: !${result.mrIid} — ${result.mrUrl}`;
	}

	const draftLabel = (params.draft as boolean | undefined) ? ' (draft)' : '';
	return `MR !${result.mrIid} created successfully${draftLabel}: ${result.mrUrl}`;
});
