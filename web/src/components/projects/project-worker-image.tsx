import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

/** Poll cadence (ms) while a worker-image set awaits router-side validation. */
export const WORKER_IMAGE_POLL_MS = 5000;

/**
 * react-query `refetchInterval` predicate for the worker-image lifecycle: keep
 * polling while the eager router-side validation is still `pending`, and stop
 * once the project resolves to `verified` / `failed` (or has no per-project
 * image at all). Mirrors `isRunActive` driving the run-status pages' polling.
 */
export function workerImagePollInterval(status: string | null | undefined): number | false {
	return status === 'pending' ? WORKER_IMAGE_POLL_MS : false;
}

/** Worker-image columns surfaced by `projects.getById` (spec 022). */
interface WorkerImageProject {
	workerImage: string | null;
	workerImageDigest: string | null;
	workerImageStatus: string | null;
	workerImageError: string | null;
}

/**
 * Renders the router-side validation lifecycle for a configured worker image:
 * a "Verifying…" spinner while `pending`, a verified badge with the pinned
 * `@sha256:` digest, or a destructive badge with the failure reason. Returns
 * `null` for any other status (including unconfigured), keeping the parent's
 * JSX flat.
 */
function WorkerImageStatusBadge({
	status,
	digest,
	errorReason,
}: {
	status: string | null;
	digest: string | null;
	errorReason: string | null;
}) {
	if (status === 'pending') {
		return (
			<div data-status="pending" className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				<span>Verifying… validating the image on the router.</span>
			</div>
		);
	}
	if (status === 'verified') {
		return (
			<div
				data-status="verified"
				className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500"
			>
				<CheckCircle2 className="h-4 w-4" />
				<span>Verified{digest ? ` — pinned to ${digest}` : ''}</span>
			</div>
		);
	}
	if (status === 'failed') {
		return (
			<div data-status="failed" className="flex items-center gap-2 text-sm text-destructive">
				<XCircle className="h-4 w-4" />
				<span>Validation failed{errorReason ? `: ${errorReason}` : ''}</span>
			</div>
		);
	}
	return null;
}

/**
 * Worker Image settings card (spec 022 plan 4/4). Lets a superadmin pin a custom
 * worker container image for the project (which must be built `FROM` the Cascade
 * worker base) and surfaces the router-side validation lifecycle:
 *
 *   - `pending`  → "Verifying…" spinner; the query polls until it resolves.
 *   - `verified` → green badge with the pinned `@sha256:` digest the worker launches.
 *   - `failed`   → destructive badge with the precise failure reason.
 *
 * Unset reverts to the global default (shown as the input placeholder). The whole
 * card is hidden for non-superadmins, mirroring the backend `projects.update`
 * gate — a non-superadmin cannot even see the control.
 */
export function ProjectWorkerImage({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();

	const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });
	const isSuperadmin = meQuery.data?.role === 'superadmin';

	const projectQuery = useQuery({
		...trpc.projects.getById.queryOptions({ id: projectId }),
		// Poll while the eager router-side validation is in flight, like the
		// run-status views. Gated on superadmin so non-superadmins never poll.
		refetchInterval: (query) =>
			isSuperadmin
				? workerImagePollInterval(
						(query.state.data as WorkerImageProject | undefined)?.workerImageStatus,
					)
				: false,
	});

	const defaultsQuery = useQuery({
		...trpc.projects.defaults.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const [ref, setRef] = useState('');

	const mutation = useMutation({
		mutationFn: (workerImage: string | null) =>
			trpcClient.projects.update.mutate({ id: projectId, workerImage }),
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

	// Superadmin-only affordance (mirrors the backend gate). Every hook above runs
	// unconditionally so this early return still obeys the rules of hooks.
	if (!isSuperadmin) return null;

	const project = projectQuery.data as WorkerImageProject | undefined;
	const currentImage = project?.workerImage ?? null;
	const status = project?.workerImageStatus ?? null;
	const digest = project?.workerImageDigest ?? null;
	const errorReason = project?.workerImageError ?? null;
	const globalDefault = defaultsQuery.data?.workerImage ?? '';

	function handleSet() {
		const trimmed = ref.trim();
		if (!trimmed) return;
		mutation.mutate(trimmed, {
			onSuccess: () => {
				setRef('');
				toast.success('Worker image set — validating on the router…');
			},
		});
	}

	function handleClear() {
		mutation.mutate(null, {
			onSuccess: () => {
				setRef('');
				toast.success('Worker image cleared — reverted to the global default');
			},
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Worker Image</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-xs text-muted-foreground">
					Pin a custom worker container image for this project's agent runs. It must be built{' '}
					<code>FROM</code> the Cascade worker base. Leave unset to use the global default.
					Superadmin-only.
				</p>

				<div className="space-y-2">
					<label htmlFor="workerImage" className="text-sm font-medium">
						Image reference
					</label>
					<Input
						id="workerImage"
						value={ref}
						onChange={(e) => setRef(e.target.value)}
						placeholder={globalDefault ? `${globalDefault} (default)` : 'registry/image:tag'}
					/>
					<p className="text-xs text-muted-foreground">
						{currentImage
							? `Configured: ${currentImage}`
							: `Unset — using the global default${globalDefault ? `: ${globalDefault}` : ''}.`}
					</p>
				</div>

				{/* Validation lifecycle (only meaningful once an image is configured). */}
				{currentImage && (
					<WorkerImageStatusBadge status={status} digest={digest} errorReason={errorReason} />
				)}

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleSet}
						disabled={mutation.isPending || !ref.trim()}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{mutation.isPending ? 'Saving…' : 'Set'}
					</button>
					{currentImage && (
						<button
							type="button"
							onClick={handleClear}
							disabled={mutation.isPending}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
						>
							Clear
						</button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
