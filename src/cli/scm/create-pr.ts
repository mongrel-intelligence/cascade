import { createPR } from '../../gadgets/github/core/createPR.js';
import { createPRDef } from '../../gadgets/github/definitions.js';
import { createMR } from '../../gadgets/gitlab/core/createMR.js';
import { writePRSidecar } from '../../gadgets/session/core/sidecar.js';
import { PR_SIDECAR_ENV_VAR } from '../../gadgets/sessionState.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider } from '../base.js';

export default createCLICommand(createPRDef, async (params) => {
	const base = params.base as string | undefined;
	if (!base) {
		throw new Error('--base is required (or set CASCADE_BASE_BRANCH env var)');
	}

	if (detectSCMProvider() === 'gitlab') {
		const result = await createMR({
			title: params.title as string,
			body: params.body as string,
			head: params.head as string,
			base,
			draft: params.draft as boolean | undefined,
			commit: params.commit as boolean | undefined,
			commitMessage: params.commitMessage as string | undefined,
			push: params.push as boolean | undefined,
		});

		writePRSidecar(
			process.env[PR_SIDECAR_ENV_VAR],
			result.mrUrl,
			result.mrIid,
			result.alreadyExisted,
			result.projectPath,
		);

		return result;
	}

	const result = await createPR({
		title: params.title as string,
		body: params.body as string,
		head: params.head as string,
		base,
		draft: params.draft as boolean | undefined,
		commit: params.commit as boolean | undefined,
		commitMessage: params.commitMessage as string | undefined,
		push: params.push as boolean | undefined,
	});

	writePRSidecar(
		process.env[PR_SIDECAR_ENV_VAR],
		result.prUrl,
		result.prNumber,
		result.alreadyExisted,
		result.repoFullName,
	);

	return result;
});
