import { AstGrep } from '../../gadgets/AstGrep.js';
import { FileSearchAndReplace } from '../../gadgets/FileSearchAndReplace.js';
import { Finish } from '../../gadgets/Finish.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { ReadFile } from '../../gadgets/ReadFile.js';
import { RipGrep } from '../../gadgets/RipGrep.js';
import { Sleep } from '../../gadgets/Sleep.js';
import { WriteFile } from '../../gadgets/WriteFile.js';
import {
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	ReplyToReviewComment,
	UpdatePRComment,
} from '../../gadgets/github/index.js';
import { Tmux } from '../../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../../gadgets/todo/index.js';
import type { CreateBuilderOptions } from './builderFactory.js';

export function createPRAgentGadgets(options?: {
	includeReviewComments?: boolean;
}): CreateBuilderOptions['gadgets'] {
	const gadgets: CreateBuilderOptions['gadgets'] = [
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new WriteFile(),
		new RipGrep(),
		new AstGrep(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new PostPRComment(),
		new UpdatePRComment(),
		new Finish(),
	];

	if (options?.includeReviewComments) {
		gadgets.push(new GetPRComments(), new ReplyToReviewComment());
	}

	return gadgets;
}
