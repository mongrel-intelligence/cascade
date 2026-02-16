import { DefaultsForm } from '@/components/settings/defaults-form.js';
import { OrgForm } from '@/components/settings/org-form.js';
import { Separator } from '@/components/ui/separator.js';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root.js';

function GeneralSettingsPage() {
	return (
		<div className="space-y-8">
			<h1 className="text-2xl font-bold tracking-tight">General Settings</h1>

			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Organization</h2>
				<OrgForm />
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Cascade Defaults</h2>
				<p className="text-sm text-muted-foreground">
					Global defaults for all projects in this organization.
				</p>
				<DefaultsForm />
			</section>
		</div>
	);
}

export const settingsGeneralRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/general',
	component: GeneralSettingsPage,
});
