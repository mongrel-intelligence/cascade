export {
	type CreatedMR,
	type CreateMRParams,
	type FailedJob,
	type FailedPipelineJobs,
	getGitLabUserForToken,
	gitlabClient,
	type MRApprovalState,
	type MRDetails,
	type MRDiffFile,
	type MRNote,
	type PipelineStatus,
	withGitLabToken,
} from './client.js';

export {
	_resetPersonaIdentityCache,
	type GitLabPersona,
	getPersonaForAgentType,
	getPersonaForLogin,
	getPersonaToken,
	isCascadeBot,
	type PersonaIdentities,
	resolvePersonaIdentities,
} from './personas.js';

export { GitLabSCMIntegration } from './scm-integration.js';
