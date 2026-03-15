import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Project {
	id: string;
	name: string;
	model: string | null;
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
	runLinksEnabled?: boolean | null;
}

function numericFieldDefault(value: number | null | undefined): string {
	return value != null ? String(value) : '';
}

export function ProjectGeneralForm({ project }: { project: Project }) {
	const updateMutation = useProjectUpdate(project.id);
	const credentialsQuery = useQuery(
		trpc.projects.credentials.list.queryOptions({ projectId: project.id }),
	);

	const [name, setName] = useState(project.name);
	const [watchdogTimeoutMs, setWatchdogTimeoutMs] = useState(
		numericFieldDefault(project.watchdogTimeoutMs),
	);
	const [progressModel, setProgressModel] = useState(project.progressModel ?? '');
	const [progressIntervalMinutes, setProgressIntervalMinutes] = useState(
		project.progressIntervalMinutes ?? '',
	);
	const [workItemBudgetUsd, setWorkItemBudgetUsd] = useState(project.workItemBudgetUsd ?? '');
	const [runLinksEnabled, setRunLinksEnabled] = useState(project.runLinksEnabled ?? false);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate({
			name,
			watchdogTimeoutMs: watchdogTimeoutMs ? Number.parseInt(watchdogTimeoutMs, 10) : null,
			progressModel: progressModel || null,
			progressIntervalMinutes: progressIntervalMinutes || null,
			workItemBudgetUsd: workItemBudgetUsd || null,
			runLinksEnabled,
		});
	}

	const credentials = credentialsQuery.data ?? [];
	const openrouterCred = credentials.find((c) => c.envVarKey === 'OPENROUTER_API_KEY');

	return (
		<div className="max-w-2xl space-y-6">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
				</div>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="workItemBudgetUsd">Work Item Budget (USD)</Label>
						<Input
							id="workItemBudgetUsd"
							value={workItemBudgetUsd}
							onChange={(e) => setWorkItemBudgetUsd(e.target.value)}
							placeholder="e.g. 5.00"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="watchdogTimeoutMs">Watchdog Timeout (ms)</Label>
						<Input
							id="watchdogTimeoutMs"
							type="number"
							min="1"
							value={watchdogTimeoutMs}
							onChange={(e) => setWatchdogTimeoutMs(e.target.value)}
							placeholder="e.g. 3600000"
						/>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="progressModel">Progress Model</Label>
						<Input
							id="progressModel"
							value={progressModel}
							onChange={(e) => setProgressModel(e.target.value)}
							placeholder="e.g. claude-haiku-3-5"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="progressIntervalMinutes">Progress Interval (minutes)</Label>
						<Input
							id="progressIntervalMinutes"
							type="number"
							min="1"
							value={progressIntervalMinutes}
							onChange={(e) => setProgressIntervalMinutes(e.target.value)}
							placeholder="e.g. 5"
						/>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<input
						type="checkbox"
						id="runLinksEnabled"
						checked={runLinksEnabled}
						onChange={(e) => setRunLinksEnabled(e.target.checked)}
						className="h-4 w-4 rounded border-border"
					/>
					<Label htmlFor="runLinksEnabled" className="cursor-pointer">
						Enable run links in comments (requires{' '}
						<code className="text-xs">CASCADE_DASHBOARD_URL</code> env var)
					</Label>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="submit"
						disabled={updateMutation.isPending}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
					</button>
					{updateMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
					{updateMutation.isError && (
						<span className="text-sm text-destructive">{updateMutation.error.message}</span>
					)}
				</div>
			</form>

			{/* API Secrets section */}
			<div className="space-y-4 border-t pt-4">
				<div>
					<h3 className="text-sm font-medium">API Keys</h3>
					<p className="text-xs text-muted-foreground mt-1">
						Project-scoped API keys for LLM providers. Values are stored encrypted and never
						returned to the browser.
					</p>
				</div>
				<ProjectSecretField
					projectId={project.id}
					envVarKey="OPENROUTER_API_KEY"
					label="OpenRouter API Key"
					description="API key for OpenRouter LLM routing (progress model). Also used as the engine API key when the OpenCode engine is selected — configure it here or on the Harness tab."
					placeholder="sk-or-..."
					credential={openrouterCred}
				/>
			</div>
		</div>
	);
}
