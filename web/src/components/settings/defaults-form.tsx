export function DefaultsForm() {
	// cascade_defaults table has been removed (migration 0038).
	// Org-level defaults are no longer stored in the database.
	// Per-project overrides (model, iterations, timeouts, etc.) are now set per-project in Project Settings.
	return (
		<div className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
			<p className="font-medium">Organization-level defaults have been removed.</p>
			<p className="mt-1">
				Per-project overrides (model, max iterations, watchdog timeout, etc.) are now configured
				directly on each project. Visit <strong>Project Settings</strong> to set overrides per
				project.
			</p>
		</div>
	);
}
