import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

/**
 * Membership-based active-org switcher (spec 021 plan 4).
 *
 * Distinct from the superadmin cross-org switcher in `sidebar.tsx`, which
 * selects ANY org via the client-side `x-org-context` header. This switcher is
 * for regular (non-superadmin) users who belong to more than one org: it lists
 * the user's memberships via `auth.listMyOrgs` and switches the SESSION's
 * `active_org_id` server-side via `auth.setActiveOrg`. The active org then drives
 * `computeEffectiveOrgId` on every subsequent request (see
 * `docs/architecture/01-services.md`), so a switch invalidates every cached
 * query to refetch the whole dashboard against the new org.
 *
 * Single-org users (≤1 membership) see no switcher — just the inert org name
 * banner (spec AC #9).
 */

export interface MyOrg {
	readonly id: string;
	readonly name: string;
	/** The user's per-org role in this org ('member' | 'admin'). */
	readonly role: string;
}

/**
 * The switcher only renders when the user belongs to more than one org. With a
 * single membership there is nothing to switch to, so the banner is inert
 * (spec AC #9 — hidden·inert for single-org).
 */
export function shouldShowOrgSwitcher(orgs: ReadonlyArray<{ id: string }>): boolean {
	return orgs.length > 1;
}

/**
 * Resolve the org name to display in the inert banner: prefer the active org
 * (matched by id), fall back to the only membership, then to the caller-supplied
 * name (the effective org name from `auth.me`).
 */
export function resolveActiveOrgName(
	orgs: ReadonlyArray<MyOrg>,
	activeOrgId: string | null,
	fallback: string | null,
): string | null {
	const match = orgs.find((o) => o.id === activeOrgId);
	if (match) return match.name;
	if (orgs.length === 1) return orgs[0].name;
	return fallback ?? null;
}

/** Inert org-name banner shown when there is nothing to switch to. */
export function OrgNameBanner({ name }: { name: string | null }) {
	return (
		<div
			className="flex h-14 items-center border-b border-sidebar-border px-4"
			data-org-switcher="true"
			data-mode="static"
		>
			<Building2 className="mr-2 h-5 w-5 shrink-0" />
			<span className="truncate font-semibold">{name ?? 'Loading...'}</span>
		</div>
	);
}

export interface OrgSwitcherViewProps {
	readonly orgs: ReadonlyArray<MyOrg>;
	readonly activeOrgId: string | null;
	readonly fallbackName: string | null;
	readonly pending?: boolean;
	readonly onSwitch: (orgId: string) => void;
}

/**
 * Presentational switcher. Pure (no hooks) so it renders under
 * `renderToStaticMarkup` in unit tests; uses the SSR-safe `NativeSelect` rather
 * than the radix `Select` for the same reason.
 */
export function OrgSwitcherView({
	orgs,
	activeOrgId,
	fallbackName,
	pending,
	onSwitch,
}: OrgSwitcherViewProps) {
	if (!shouldShowOrgSwitcher(orgs)) {
		return <OrgNameBanner name={resolveActiveOrgName(orgs, activeOrgId, fallbackName)} />;
	}

	return (
		<div
			className="relative flex h-14 items-center border-b border-sidebar-border"
			data-org-switcher="true"
			data-mode="switcher"
			data-active-org-id={activeOrgId ?? ''}
		>
			<Building2 className="pointer-events-none absolute left-4 h-4 w-4 shrink-0 text-muted-foreground" />
			<NativeSelect
				aria-label="Switch organization"
				value={activeOrgId ?? ''}
				disabled={pending}
				onChange={(e) => onSwitch(e.target.value)}
				className="h-14 rounded-none border-0 bg-transparent pl-10 pr-3 text-sm font-semibold focus-visible:ring-0"
			>
				{orgs.map((org) => (
					<option key={org.id} value={org.id}>
						{org.name}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

/**
 * Container: wires the membership list, the current active org (from
 * `auth.me.effectiveOrgId`), and the switch mutation. On success it invalidates
 * every query so the whole dashboard refetches against the new active org.
 */
export function OrgSwitcher({ fallbackName }: { fallbackName: string | null }) {
	const queryClient = useQueryClient();
	const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });
	const myOrgsQuery = useQuery(trpc.auth.listMyOrgs.queryOptions());
	const orgs = myOrgsQuery.data ?? [];
	const activeOrgId = meQuery.data?.effectiveOrgId ?? null;

	const switchMutation = useMutation({
		mutationFn: (orgId: string) => trpcClient.auth.setActiveOrg.mutate({ orgId }),
		onSuccess: () => {
			// The active org now lives in the session server-side, so every
			// org-scoped query (and auth.me) must refetch to reflect the new org.
			queryClient.invalidateQueries();
		},
	});

	return (
		<OrgSwitcherView
			orgs={orgs}
			activeOrgId={activeOrgId}
			fallbackName={fallbackName}
			pending={switchMutation.isPending}
			onSwitch={(orgId) => {
				if (orgId !== activeOrgId) switchMutation.mutate(orgId);
			}}
		/>
	);
}
