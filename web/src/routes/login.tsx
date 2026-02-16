import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from './__root.js';

function LoginPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError('');
		setLoading(true);

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});

			if (!res.ok) {
				const data = await res.json();
				setError(data.error || 'Login failed');
				return;
			}

			await queryClient.invalidateQueries();
			navigate({ to: '/' });
		} catch {
			setError('Network error');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="w-full max-w-sm space-y-6 rounded-lg border border-border p-8">
				<div className="space-y-2 text-center">
					<h1 className="text-2xl font-bold tracking-tight">CASCADE</h1>
					<p className="text-sm text-muted-foreground">Sign in to your dashboard</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					{error && (
						<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}

					<div className="space-y-2">
						<label htmlFor="email" className="text-sm font-medium">
							Email
						</label>
						<input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							placeholder="you@example.com"
						/>
					</div>

					<div className="space-y-2">
						<label htmlFor="password" className="text-sm font-medium">
							Password
						</label>
						<input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</div>

					<button
						type="submit"
						disabled={loading}
						className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>
						{loading ? 'Signing in...' : 'Sign in'}
					</button>
				</form>
			</div>
		</div>
	);
}

export const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/login',
	component: LoginPage,
});
