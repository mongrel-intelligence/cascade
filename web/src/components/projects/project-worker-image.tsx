import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import { Textarea } from '@/components/ui/textarea.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

/** Poll cadence (ms) while a worker-image set awaits router-side validation. */
export const WORKER_IMAGE_POLL_MS = 5000;

/**
 * react-query `refetchInterval` predicate for the worker-image lifecycle: keep
 * polling while *any* router-side work is in flight and stop once everything
 * settles. Three in-flight signals, all reusing {@link WORKER_IMAGE_POLL_MS}:
 *
 *   - `workerImageStatus === 'pending'`  — a referenced image is being validated
 *     (spec 022), OR
 *   - `workerImageStatus === 'building'` — a FIRST Dockerfile build with no prior
 *     verified pin (the project cannot launch yet), OR
 *   - `workerImageBuildStatus === 'building'` — a **rebuild** attempt is running
 *     while the launchable pin stays `verified` (spec 023 no-strand).
 *
 * The second argument is optional so existing single-status callers (and the
 * spec-022 tests) keep their exact behavior: `'verified'` / `'failed'` / `null`
 * all resolve to `false`.
 */
export function workerImagePollInterval(
	status: string | null | undefined,
	buildStatus?: string | null | undefined,
): number | false {
	return status === 'pending' || status === 'building' || buildStatus === 'building'
		? WORKER_IMAGE_POLL_MS
		: false;
}

/** Effective worker-image source, derived client-side from the two source columns. */
export type WorkerImageSource = 'default' | 'reference' | 'dockerfile';

/**
 * Derives the effective image source the same way the backend does (spec 023):
 * `dockerfile` (content set) > `reference` (ref set) > `default` (neither). The
 * dashboard mirrors this instead of reading a `workerImageSource` field because
 * `projects.getById` returns the raw project row, not the mapped config.
 */
export function deriveWorkerImageSource(project: {
	workerImage: string | null;
	workerDockerfile: string | null;
}): WorkerImageSource {
	if (project.workerDockerfile != null) return 'dockerfile';
	if (project.workerImage != null) return 'reference';
	return 'default';
}

/** Worker-image columns surfaced by `projects.getById` (spec 022 + 023). */
interface WorkerImageProject {
	workerImage: string | null;
	workerImageDigest: string | null;
	workerImageStatus: string | null;
	workerImageError: string | null;
	workerDockerfile: string | null;
	workerImageBuildStatus: string | null;
}

/**
 * Renders the router-side lifecycle for a configured worker image. The display
 * deliberately separates two independent axes (spec 023):
 *
 *   - the **active image** (`workerImageStatus`): `pending` → validating a
 *     referenced image; `building` → a first Dockerfile build with no launchable
 *     pin yet; `verified` → running the pinned `@sha256:` / local image; `failed`
 *     → nothing launchable.
 *   - the **most recent build attempt** (`workerImageBuildStatus`), only
 *     meaningful for a Dockerfile source: `building` → a rebuild is running while
 *     the last-good image keeps launching; `failed` → the rebuild failed but the
 *     project still runs its last verified image.
 *
 * So a project on its last-good image while a rebuild fails reads
 * "Verified … · last rebuild failed: <reason>" — NOT a misleading "Failed".
 * Returns `null` for any other status (including unconfigured).
 */
function WorkerImageStatusBadge({
	status,
	digest,
	errorReason,
	buildStatus,
}: {
	status: string | null;
	digest: string | null;
	errorReason: string | null;
	buildStatus: string | null;
}) {
	if (status === 'pending') {
		return (
			<div data-status="pending" className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				<span>Verifying… validating the image on the router.</span>
			</div>
		);
	}
	if (status === 'building') {
		// A first Dockerfile build with no prior verified pin — nothing launches yet.
		return (
			<div data-status="building" className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				<span>Building… assembling the worker image on the router.</span>
			</div>
		);
	}
	if (status === 'verified') {
		return (
			<div className="space-y-1">
				<div
					data-status="verified"
					className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500"
				>
					<CheckCircle2 className="h-4 w-4" />
					<span>Verified{digest ? ` — pinned to ${digest}` : ''}</span>
				</div>
				{/* A rebuild is in flight; the verified pin above still launches. */}
				{buildStatus === 'building' && (
					<div
						data-build-status="building"
						className="flex items-center gap-2 text-sm text-muted-foreground"
					>
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>Rebuilding… still running the last verified image.</span>
					</div>
				)}
				{/* The rebuild failed; the verified pin above keeps the project runnable. */}
				{buildStatus === 'failed' && (
					<div
						data-build-status="failed"
						className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500"
					>
						<XCircle className="h-4 w-4" />
						<span>
							Last rebuild failed{errorReason ? `: ${errorReason}` : ''} — still running the last
							verified image.
						</span>
					</div>
				)}
			</div>
		);
	}
	if (status === 'failed') {
		return (
			<div data-status="failed" className="flex items-center gap-2 text-sm text-destructive">
				<XCircle className="h-4 w-4" />
				<span>Failed{errorReason ? `: ${errorReason}` : ''}</span>
			</div>
		);
	}
	return null;
}

/**
 * Amber notice shown when a persisted override from a *different* source than the
 * one currently selected is still driving every run. It appears (a) on the
 * **Global default** view whenever any override is persisted, and (b) on an
 * override view (**Referenced image** / **Dockerfile**) when the *other* override
 * source is the persisted one — because backend mutual exclusivity nulls the
 * non-selected source's column, so the selected control looks empty even though
 * the cross-source override is what actually launches. Without this, that empty
 * control would falsely read "Unset — using the global default…". The button
 * performs the genuine revert, routed to whichever source is persisted.
 */
function CrossSourceOverrideNotice({
	persistedSource,
	globalDefault,
	onClear,
	disabled,
}: {
	persistedSource: WorkerImageSource;
	globalDefault: string;
	onClear: () => void;
	disabled: boolean;
}) {
	return (
		<div data-source="cross-override" className="space-y-2">
			<p className="text-xs text-amber-600 dark:text-amber-500">
				A {persistedSource === 'dockerfile' ? 'Dockerfile' : 'referenced image'} override is still
				configured, so every run keeps using it. Clear it to revert to the global default
				{globalDefault ? `: ${globalDefault}` : ''}.
			</p>
			<button
				type="button"
				onClick={onClear}
				disabled={disabled}
				className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
			>
				Clear override
			</button>
		</div>
	);
}

/**
 * Worker Image settings card (spec 022 plan 4 + spec 023 plan 5). Lets a
 * superadmin choose the project's worker-image **source** and manage it:
 *
 *   - **Global default** — no per-project image; every run uses the global base.
 *   - **Referenced image** — pin a prebuilt image reference (spec 022); the
 *     router validates it and pins its `@sha256:` digest.
 *   - **Dockerfile** — paste *extra layers only* (CASCADE supplies the pinned
 *     `FROM` worker base, spec 023); the router builds + verifies the image
 *     locally. A Rebuild button re-runs the build against a refreshed base.
 *
 * The two override sources are **mutually exclusive**: selecting one hides the
 * other's control, matching the backend invariant (a project has exactly one
 * effective image source). The whole card is hidden for non-superadmins,
 * mirroring the backend `projects.update` gate.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single settings card composing three mutually-exclusive source controls (default / reference / dockerfile) plus the shared build-status lifecycle
export function ProjectWorkerImage({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });
	const isSuperadmin = meQuery.data?.role === 'superadmin';

	const projectQuery = useQuery({
		...trpc.projects.getById.queryOptions({ id: projectId }),
		// Poll while any router-side build/validation is in flight, like the
		// run-status views. Gated on superadmin so non-superadmins never poll.
		refetchInterval: (query) =>
			isSuperadmin
				? workerImagePollInterval(
						(query.state.data as WorkerImageProject | undefined)?.workerImageStatus,
						(query.state.data as WorkerImageProject | undefined)?.workerImageBuildStatus,
					)
				: false,
	});

	const defaultsQuery = useQuery({
		...trpc.projects.defaults.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const project = projectQuery.data as WorkerImageProject | undefined;
	const persistedSource = deriveWorkerImageSource({
		workerImage: project?.workerImage ?? null,
		workerDockerfile: project?.workerDockerfile ?? null,
	});

	const [ref, setRef] = useState('');
	// `null` = "not yet edited"; falls back to the persisted content so the
	// textarea shows the saved Dockerfile and the operator edits from there.
	const [dockerfileDraft, setDockerfileDraft] = useState<string | null>(null);
	// `null` = "follow the persisted source" until the operator explicitly picks
	// another source from the selector (which is initialized from the derived one).
	const [sourceOverride, setSourceOverride] = useState<WorkerImageSource | null>(null);
	const selectedSource = sourceOverride ?? persistedSource;

	const updateMutation = useMutation({
		mutationFn: (payload: { workerImage?: string | null; workerDockerfile?: string | null }) =>
			trpcClient.projects.update.mutate({ id: projectId, ...payload }),
		onSuccess: () => {
			// Refetch the project (drives the status badge + polling) and the
			// projects list (badge/state may surface there too).
			queryClient.invalidateQueries({
				queryKey: trpc.projects.getById.queryOptions({ id: projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.listFull.queryOptions().queryKey,
			});
		},
		onError: (err) => {
			toast.error('Failed to update worker image', {
				description: err instanceof Error ? err.message : String(err),
			});
		},
	});

	const rebuildMutation = useMutation({
		mutationFn: () => trpcClient.projects.rebuildWorkerImage.mutate({ projectId }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.getById.queryOptions({ id: projectId }).queryKey,
			});
		},
		onError: (err) => {
			toast.error('Failed to trigger a rebuild', {
				description: err instanceof Error ? err.message : String(err),
			});
		},
	});

	// Superadmin-only affordance (mirrors the backend gate). Every hook above runs
	// unconditionally so this early return still obeys the rules of hooks.
	if (!isSuperadmin) return null;

	const currentImage = project?.workerImage ?? null;
	const currentDockerfile = project?.workerDockerfile ?? null;
	const status = project?.workerImageStatus ?? null;
	const digest = project?.workerImageDigest ?? null;
	const errorReason = project?.workerImageError ?? null;
	const buildStatus = project?.workerImageBuildStatus ?? null;
	const globalDefault = defaultsQuery.data?.workerImage ?? '';
	const dockerfileValue = dockerfileDraft ?? currentDockerfile ?? '';
	// Rebuild rebuilds the *persisted* Dockerfile, so unedited-since-save is the
	// precondition for it to do what the operator expects. When the textarea
	// diverges from the saved content, disable Rebuild (and hint why) so unsaved
	// edits aren't silently ignored — the operator must Set them first.
	const hasUnsavedDockerfileEdits =
		dockerfileDraft !== null && dockerfileDraft !== (currentDockerfile ?? '');

	function handleSetReference() {
		const trimmed = ref.trim();
		if (!trimmed) return;
		updateMutation.mutate(
			{ workerImage: trimmed },
			{
				onSuccess: () => {
					setRef('');
					toast.success('Worker image set — validating on the router…');
				},
			},
		);
	}

	function handleClearReference() {
		updateMutation.mutate(
			{ workerImage: null },
			{
				onSuccess: () => {
					setRef('');
					setSourceOverride('default');
					toast.success('Worker image cleared — reverted to the global default');
				},
			},
		);
	}

	function handleSetDockerfile() {
		const content = dockerfileValue;
		if (!content.trim()) return;
		updateMutation.mutate(
			{ workerDockerfile: content },
			{
				onSuccess: () => {
					setDockerfileDraft(null);
					toast.success('Dockerfile saved — building the worker image on the router…');
				},
			},
		);
	}

	function handleClearDockerfile() {
		updateMutation.mutate(
			{ workerDockerfile: null },
			{
				onSuccess: () => {
					setDockerfileDraft(null);
					setSourceOverride('default');
					toast.success('Dockerfile cleared — reverted to the global default');
				},
			},
		);
	}

	function handleRebuild() {
		rebuildMutation.mutate(undefined, {
			onSuccess: () => {
				toast.success('Rebuild triggered — building the worker image on the router…');
			},
		});
	}

	// The genuine revert for a persisted override, routed to whichever source is
	// actually persisted. Shared by the Global-default view and by the two
	// override views when a *cross-source* override is still active.
	const clearOverride =
		persistedSource === 'dockerfile' ? handleClearDockerfile : handleClearReference;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Worker Image</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-xs text-muted-foreground">
					Choose the worker container image for this project's agent runs. Leave it on the global
					default, pin a prebuilt <strong>referenced image</strong>, or supply a{' '}
					<strong>Dockerfile</strong> of extra layers that CASCADE builds on top of the worker base.
					A referenced image and a Dockerfile are mutually exclusive. Superadmin-only.
				</p>

				<div className="space-y-2">
					<label htmlFor="workerImageSource" className="text-sm font-medium">
						Image source
					</label>
					<NativeSelect
						id="workerImageSource"
						value={selectedSource}
						onChange={(e) => setSourceOverride(e.target.value as WorkerImageSource)}
					>
						<option value="default">Global default</option>
						<option value="reference">Referenced image</option>
						<option value="dockerfile">Dockerfile</option>
					</NativeSelect>
				</div>

				{/* Global default AND nothing persisted — the default is genuinely in use. */}
				{selectedSource === 'default' && persistedSource === 'default' && (
					<p data-source="default" className="text-xs text-muted-foreground">
						Using the global default worker image{globalDefault ? `: ${globalDefault}` : ''}. Choose{' '}
						<strong>Referenced image</strong> or <strong>Dockerfile</strong> to override it for this
						project.
					</p>
				)}

				{/* Global default selected but an override is STILL persisted: picking
				    "Global default" in the selector clears nothing on its own, so the
				    saved reference/Dockerfile keeps driving every run. Report the true
				    state and surface the real revert (Clear) rather than falsely
				    claiming the default is already in use. */}
				{selectedSource === 'default' && persistedSource !== 'default' && (
					<CrossSourceOverrideNotice
						persistedSource={persistedSource}
						globalDefault={globalDefault}
						onClear={clearOverride}
						disabled={updateMutation.isPending}
					/>
				)}

				{/* Referenced image (spec 022 control, unchanged). */}
				{selectedSource === 'reference' && (
					<div data-source="reference" className="space-y-2">
						<label htmlFor="workerImage" className="text-sm font-medium">
							Image reference
						</label>
						<Input
							id="workerImage"
							value={ref}
							onChange={(e) => setRef(e.target.value)}
							placeholder={globalDefault ? `${globalDefault} (default)` : 'registry/image:tag'}
						/>
						{currentImage && (
							<p className="text-xs text-muted-foreground">Configured: {currentImage}</p>
						)}
						{/* Gate the "using the global default" copy on the persisted source
						    actually being `default`. Selecting "Referenced image" while a
						    Dockerfile override is persisted leaves this input empty
						    (`currentImage` is null because backend mutual exclusivity nulls
						    `workerImage`), so an unconditional "Unset — using the global
						    default…" would misreport: the Dockerfile still drives every run. */}
						{!currentImage && persistedSource === 'default' && (
							<p className="text-xs text-muted-foreground">
								Unset — using the global default{globalDefault ? `: ${globalDefault}` : ''}.
							</p>
						)}
						{!currentImage && persistedSource === 'dockerfile' && (
							<CrossSourceOverrideNotice
								persistedSource={persistedSource}
								globalDefault={globalDefault}
								onClear={clearOverride}
								disabled={updateMutation.isPending}
							/>
						)}

						{currentImage && (
							<WorkerImageStatusBadge
								status={status}
								digest={digest}
								errorReason={errorReason}
								buildStatus={buildStatus}
							/>
						)}

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={handleSetReference}
								disabled={updateMutation.isPending || !ref.trim()}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{updateMutation.isPending ? 'Saving…' : 'Set'}
							</button>
							{currentImage && (
								<button
									type="button"
									onClick={handleClearReference}
									disabled={updateMutation.isPending}
									className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
								>
									Clear
								</button>
							)}
						</div>
					</div>
				)}

				{/* Dockerfile source (spec 023): extra layers only; CASCADE supplies FROM. */}
				{selectedSource === 'dockerfile' && (
					<div data-source="dockerfile" className="space-y-2">
						<label htmlFor="workerDockerfile" className="text-sm font-medium">
							Dockerfile extra layers
						</label>
						<Textarea
							id="workerDockerfile"
							value={dockerfileValue}
							onChange={(e) => setDockerfileDraft(e.target.value)}
							spellCheck={false}
							rows={8}
							className="font-mono text-xs"
							placeholder={
								'# CASCADE supplies the pinned FROM worker base — provide only extra layers.\nRUN sudo apt-get update && sudo apt-get install -y protobuf-compiler'
							}
						/>
						<p className="text-xs text-muted-foreground">
							Supply <strong>only the extra layers</strong> (RUN / COPY / ENV …). CASCADE prepends
							the pinned <code>FROM</code> worker base, then builds and verifies the image on the
							router. The built image stays local to the router that built it.
						</p>

						{/* Symmetric to the Referenced-image view: selecting "Dockerfile"
						    while a referenced image is persisted leaves this textarea empty
						    (`currentDockerfile` is null via backend mutual exclusivity), so
						    surface the true state — the referenced image still drives runs —
						    rather than silently implying nothing is configured. */}
						{!currentDockerfile && persistedSource === 'reference' && (
							<CrossSourceOverrideNotice
								persistedSource={persistedSource}
								globalDefault={globalDefault}
								onClear={clearOverride}
								disabled={updateMutation.isPending}
							/>
						)}

						{currentDockerfile && (
							<WorkerImageStatusBadge
								status={status}
								digest={digest}
								errorReason={errorReason}
								buildStatus={buildStatus}
							/>
						)}

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={handleSetDockerfile}
								disabled={updateMutation.isPending || !dockerfileValue.trim()}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{updateMutation.isPending ? 'Saving…' : 'Set'}
							</button>
							{currentDockerfile && (
								<>
									<button
										type="button"
										onClick={handleClearDockerfile}
										disabled={updateMutation.isPending}
										className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
									>
										Clear
									</button>
									<button
										type="button"
										onClick={handleRebuild}
										disabled={rebuildMutation.isPending || hasUnsavedDockerfileEdits}
										title={
											hasUnsavedDockerfileEdits
												? 'Rebuild uses the saved Dockerfile. Click Set to save your edits first.'
												: undefined
										}
										className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
									>
										{rebuildMutation.isPending ? 'Rebuilding…' : 'Rebuild'}
									</button>
								</>
							)}
						</div>

						{/* Rebuild acts on the saved Dockerfile, so warn when unsaved edits
						    in the textarea would be ignored until the operator clicks Set. */}
						{currentDockerfile && hasUnsavedDockerfileEdits && (
							<p className="text-xs text-amber-600 dark:text-amber-500">
								Rebuild uses the saved Dockerfile — click Set to save your edits first.
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
