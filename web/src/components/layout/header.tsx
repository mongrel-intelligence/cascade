import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { API_URL } from '@/lib/api.js';
import { useOrgContext } from '@/lib/org-context.js';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Building2, LogOut } from 'lucide-react';

interface HeaderProps {
	user: { name: string; role: string } | undefined;
}

export function Header({ user }: HeaderProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { effectiveOrgId, availableOrgs, isAdmin, switchOrg } = useOrgContext();

	const orgName =
		isAdmin && availableOrgs
			? (availableOrgs.find((o) => o.id === effectiveOrgId)?.name ?? effectiveOrgId)
			: null;

	async function handleLogout() {
		await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
		queryClient.clear();
		navigate({ to: '/login' });
	}

	return (
		<header className="flex h-14 items-center justify-between border-b border-border px-6">
			<div className="flex items-center gap-2">
				{isAdmin && availableOrgs && availableOrgs.length > 1 ? (
					<Select value={effectiveOrgId ?? undefined} onValueChange={switchOrg}>
						<SelectTrigger className="h-8 text-xs gap-1.5">
							<Building2 className="h-3.5 w-3.5" />
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{availableOrgs.map((org) => (
								<SelectItem key={org.id} value={org.id} className="text-xs">
									{org.name ?? org.id}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					isAdmin && orgName && <span className="text-sm text-muted-foreground">{orgName}</span>
				)}
			</div>
			<div className="flex items-center gap-4">
				{user && <span className="text-sm text-muted-foreground">{user.name}</span>}
				<button
					type="button"
					onClick={handleLogout}
					className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<LogOut className="h-4 w-4" />
					Sign out
				</button>
			</div>
		</header>
	);
}
