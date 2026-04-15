import { createRoute } from '@tanstack/react-router';
import { OrgForm } from '@/components/settings/org-form.js';
import { rootRoute } from '../__root.js';

function GeneralSettingsPage() {
	return (
		<div className="space-y-8">
			<h1 className="text-2xl font-bold tracking-tight">General Settings</h1>

			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Organization</h2>
				<OrgForm />
			</section>
		</div>
	);
}

export const settingsGeneralRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/general',
	component: GeneralSettingsPage,
});
