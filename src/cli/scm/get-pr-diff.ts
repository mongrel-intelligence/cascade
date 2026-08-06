import { getPRDiff } from '../../gadgets/github/core/getPRDiff.js';
import { getPRDiffDef } from '../../gadgets/github/definitions.js';
import { getMRDiff } from '../../gadgets/gitlab/core/getMRDiff.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(getPRDiffDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		return getMRDiff(projectPath, params.prNumber as number);
	}
	return getPRDiff(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.path as string | undefined,
		params.outputFile as string | undefined,
	);
});
