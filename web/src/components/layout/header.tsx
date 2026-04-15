import { Breadcrumbs } from '@/components/layout/breadcrumbs.js';
import { API_URL } from '@/lib/api.js';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useState } from 'react';

interface HeaderProps {
	user: { name: string; role: string } | undefined;
	mobileMenuTrigger?: ReactNode;
}

export function Header({ user, mobileMenuTrigger }: HeaderProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	async function handleLogout() {
		await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
		queryClient.clear();
		navigate({ to: '/login' });
	}

	function toggleTheme() {
		setTheme(theme === 'dark' ? 'light' : 'dark');
	}

	return (
		<header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{mobileMenuTrigger && <div className="md:hidden">{mobileMenuTrigger}</div>}
				<div className="min-w-0 flex-1 overflow-hidden">
					<Breadcrumbs />
				</div>
			</div>
			<div className="flex items-center gap-2 md:gap-4">
				{user && (
					<span className="hidden sm:inline text-sm text-muted-foreground">{user.name}</span>
				)}
				{mounted && (
					<button
						type="button"
						onClick={toggleTheme}
						className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Toggle theme"
					>
						{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
					</button>
				)}
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
