import { DefaultsForm } from '@/components/settings/defaults-form.js';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root.js';

function GlobalDefaultsPage() {
	return (
		<div className="space-y-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-bold tracking-tight">Cascade Defaults</h1>
				<p className="text-muted-foreground">
					Global defaults for all projects in this organization.
				</p>
			</div>

			<DefaultsForm />
		</div>
	);
}

export const globalDefaultsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/defaults',
	component: GlobalDefaultsPage,
});
