import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { queryClient } from './query-client';
import { setOrgContextGetter } from './trpc';

interface OrgContextValue {
	effectiveOrgId: string | null;
	availableOrgs: { id: string; name: string }[] | undefined;
	orgName: string | null;
	isAdmin: boolean;
	switchOrg: (orgId: string) => void;
}

const OrgContext = createContext<OrgContextValue>({
	effectiveOrgId: null,
	availableOrgs: undefined,
	orgName: null,
	isAdmin: false,
	switchOrg: () => {},
});

const STORAGE_KEY = 'cascade_org_context';

interface MeData {
	orgId: string;
	role: string;
	effectiveOrgId: string;
	orgName?: string | null;
	availableOrgs?: { id: string; name: string }[];
}

export function OrgProvider({
	children,
	me,
}: { children: React.ReactNode; me: MeData | undefined }) {
	const [effectiveOrgId, setEffectiveOrgId] = useState<string | null>(null);
	const isAdmin = me?.role === 'superadmin';
	const initialized = useRef(false);

	// Initialize from me data + localStorage
	useEffect(() => {
		if (!me || initialized.current) return;
		initialized.current = true;

		if (isAdmin) {
			const stored = localStorage.getItem(STORAGE_KEY);
			// Validate stored org is in the available list
			if (stored && me.availableOrgs?.some((o) => o.id === stored)) {
				setEffectiveOrgId(stored);
			} else {
				setEffectiveOrgId(me.orgId);
			}
		} else {
			// Members always use their own org
			localStorage.removeItem(STORAGE_KEY);
			setEffectiveOrgId(me.orgId);
		}
	}, [me, isAdmin]);

	// Wire up the tRPC header getter
	useEffect(() => {
		setOrgContextGetter(() => effectiveOrgId);
	}, [effectiveOrgId]);

	const switchOrg = useCallback(
		(orgId: string) => {
			if (!isAdmin) return;
			setEffectiveOrgId(orgId);
			localStorage.setItem(STORAGE_KEY, orgId);
			queryClient.invalidateQueries();
		},
		[isAdmin],
	);

	// Derive orgName: for superadmins look up from availableOrgs by effectiveOrgId;
	// for regular users use the orgName from the API response.
	const orgName = isAdmin
		? (me?.availableOrgs?.find((o) => o.id === effectiveOrgId)?.name ?? null)
		: (me?.orgName ?? null);

	return (
		<OrgContext.Provider
			value={{
				effectiveOrgId,
				availableOrgs: me?.availableOrgs,
				orgName,
				isAdmin,
				switchOrg,
			}}
		>
			{children}
		</OrgContext.Provider>
	);
}

export function useOrgContext() {
	return useContext(OrgContext);
}
