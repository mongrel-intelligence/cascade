import { createRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { rootRoute } from '../__root.js';

function TrelloCallbackPage() {
	// Compute synchronously on first render — no intermediate "processing" state.
	// Opener is checked first: direct navigation gives a clearer error than "no token".
	const [{ token, error }] = useState(() => {
		if (!window.opener) {
			return { token: null, error: 'This page must be opened from the CASCADE dashboard.' };
		}
		const params = new URLSearchParams(window.location.hash.slice(1));
		const t = params.get('token');
		return t
			? { token: t, error: null }
			: { token: null, error: 'No token found in URL. Please try again.' };
	});

	// Guard against double-fire in React StrictMode (mount → unmount → remount).
	const messageSent = useRef(false);

	useEffect(() => {
		if (!token || messageSent.current) return;
		messageSent.current = true;
		// window.opener is guaranteed non-null: the initializer returns early if it's absent.
		window.opener.postMessage({ type: 'trello_oauth_callback', token }, window.location.origin);
		const timer = setTimeout(() => window.close(), 1000);
		return () => clearTimeout(timer);
	}, [token]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="space-y-2 text-center">
				{error ? (
					<>
						<p className="font-medium text-destructive">Authorization failed.</p>
						<p className="text-sm text-muted-foreground">{error}</p>
					</>
				) : (
					<>
						<p className="font-medium text-foreground">Authorization complete.</p>
						<p className="text-sm text-muted-foreground">You can close this window.</p>
					</>
				)}
			</div>
		</div>
	);
}

export const trelloCallbackRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/oauth/trello/callback',
	component: TrelloCallbackPage,
});
