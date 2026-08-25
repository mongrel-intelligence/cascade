/**
 * The `projects.update` payload the SCM tab sends (spec 024 plan 5).
 *
 * Pure and separate from the component so the shape can be pinned directly:
 * whether a field is *absent* is load-bearing here, and absence is exactly what
 * a DOM assertion is worst at seeing.
 */

export interface ScmSaveInput {
	readonly projectId: string;
	readonly repo: string;
	readonly baseBranch: string;
	readonly branchPrefix: string;
	/**
	 * The repository role the operator chose, or `undefined` when they have not
	 * touched the control.
	 */
	readonly repoPrimary: boolean | undefined;
}

export interface ScmSavePayload {
	id: string;
	repo: string | undefined;
	baseBranch: string;
	branchPrefix: string;
	repoPrimary?: boolean;
}

export function buildScmSavePayload(input: ScmSaveInput): ScmSavePayload {
	const repo = input.repo || undefined;
	return {
		id: input.projectId,
		repo,
		baseBranch: input.baseBranch,
		branchPrefix: input.branchPrefix,
		// Omitted when untouched: the backend preserves the stored role for an
		// update that does not mention it, so an unrelated save leaves a shared
		// repository's topology alone. Omitted without a repo because a role
		// describes a repository — the backend rejects the pair, and there is no
		// reason to let the UI produce a request that cannot succeed.
		...(repo && input.repoPrimary !== undefined ? { repoPrimary: input.repoPrimary } : {}),
	};
}
