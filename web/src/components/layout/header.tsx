import { Badge } from '@/components/ui/badge.js';
import { useOrgContext } from '@/lib/org-context.js';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';

interface HeaderProps {
	user: { name: string; role: string } | undefined;
}

export function Header({ user }: HeaderProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { effectiveOrgId, availableOrgs, isAdmin } = useOrgContext();

	const orgName =
		isAdmin && availableOrgs
			? (availableOrgs.find((o) => o.id === effectiveOrgId)?.name ?? effectiveOrgId)
			: null;

	async function handleLogout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		queryClient.clear();
		navigate({ to: '/login' });
	}

	return (
		<header className="flex h-14 items-center justify-between border-b border-border px-6">
			<div className="flex items-center gap-2">
				{isAdmin && orgName && <Badge variant="outline">{orgName}</Badge>}
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
