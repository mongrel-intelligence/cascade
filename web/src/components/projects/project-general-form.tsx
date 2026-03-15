import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface Project {
	id: string;
	name: string;
	repo: string | null;
	model: string | null;
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
	runLinksEnabled?: boolean | null;
	maxInFlightItems?: number | null;
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
	const [maxInFlightItems, setMaxInFlightItems] = useState(
		numericFieldDefault(project.maxInFlightItems),
	);
	const [runLinksEnabled, setRunLinksEnabled] = useState(project.runLinksEnabled ?? false);

	// Track dirty state to enable/disable Save button
	const isDirty = useMemo(() => {
		return (
			name !== project.name ||
			watchdogTimeoutMs !== numericFieldDefault(project.watchdogTimeoutMs) ||
			progressModel !== (project.progressModel ?? '') ||
			progressIntervalMinutes !== (project.progressIntervalMinutes ?? '') ||
			workItemBudgetUsd !== (project.workItemBudgetUsd ?? '') ||
			maxInFlightItems !== numericFieldDefault(project.maxInFlightItems) ||
			runLinksEnabled !== (project.runLinksEnabled ?? false)
		);
	}, [
		name,
		watchdogTimeoutMs,
		progressModel,
		progressIntervalMinutes,
		workItemBudgetUsd,
		maxInFlightItems,
		runLinksEnabled,
		project,
	]);

	function handleReset() {
		setName(project.name);
		setWatchdogTimeoutMs(numericFieldDefault(project.watchdogTimeoutMs));
		setProgressModel(project.progressModel ?? '');
		setProgressIntervalMinutes(project.progressIntervalMinutes ?? '');
		setWorkItemBudgetUsd(project.workItemBudgetUsd ?? '');
		setMaxInFlightItems(numericFieldDefault(project.maxInFlightItems));
		setRunLinksEnabled(project.runLinksEnabled ?? false);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate(
			{
				name,
				watchdogTimeoutMs: watchdogTimeoutMs ? Number.parseInt(watchdogTimeoutMs, 10) : null,
				progressModel: progressModel || null,
				progressIntervalMinutes: progressIntervalMinutes || null,
				workItemBudgetUsd: workItemBudgetUsd || null,
				maxInFlightItems: maxInFlightItems ? Number.parseInt(maxInFlightItems, 10) : null,
				runLinksEnabled,
			},
			{
				onSuccess: () => {
					toast.success('Project settings saved');
				},
				onError: (err) => {
					toast.error('Failed to save project settings', { description: err.message });
				},
			},
		);
	}

	const credentials = credentialsQuery.data ?? [];
	const openrouterCred = credentials.find((c) => c.envVarKey === 'OPENROUTER_API_KEY');

	return (
		<div className="max-w-2xl space-y-6">
			<form onSubmit={handleSubmit} className="space-y-6">
				{/* Project Identity */}
				<Card>
					<CardHeader>
						<CardTitle>Project Identity</CardTitle>
						<CardDescription>Basic identification and naming for this project.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">ID:</span>
							<Badge variant="secondary" className="font-mono text-xs">
								{project.id}
							</Badge>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Repository:</span>
							{project.repo ? (
								<a
									href={`https://github.com/${project.repo}`}
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-primary hover:underline font-mono"
								>
									{project.repo}
								</a>
							) : (
								<span className="text-sm text-muted-foreground">
									Not configured —{' '}
									<Link
										to="/projects/$projectId/integrations"
										params={{ projectId: project.id }}
										className="text-primary hover:underline"
									>
										set on Integrations tab →
									</Link>
								</span>
							)}
						</div>
						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
							<p className="text-xs text-muted-foreground">
								Display name for this project shown in the dashboard.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Budget & Limits */}
				<Card>
					<CardHeader>
						<CardTitle>Budget & Limits</CardTitle>
						<CardDescription>
							Control spending and concurrency limits for agent runs.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="workItemBudgetUsd">Work Item Budget (USD)</Label>
								<Input
									id="workItemBudgetUsd"
									value={workItemBudgetUsd}
									onChange={(e) => setWorkItemBudgetUsd(e.target.value)}
									placeholder="e.g. 5.00"
								/>
								<p className="text-xs text-muted-foreground">
									Maximum spend per work item before the agent stops. Leave empty for no limit.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="maxInFlightItems">Max In-Flight Items</Label>
								<Input
									id="maxInFlightItems"
									type="number"
									min="1"
									value={maxInFlightItems}
									onChange={(e) => setMaxInFlightItems(e.target.value)}
									placeholder="1 (default)"
								/>
								<p className="text-xs text-muted-foreground">
									Maximum items in TODO + In Progress + In Review simultaneously. Defaults to 1.
								</p>
							</div>
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
							<p className="text-xs text-muted-foreground">
								Maximum duration (in milliseconds) before a stalled agent run is forcibly
								terminated. Leave empty to use the system default.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Progress Monitoring */}
				<Card>
					<CardHeader>
						<CardTitle>Progress Monitoring</CardTitle>
						<CardDescription>
							Configure how agent progress is reported during long-running tasks.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="progressModel">Progress Model</Label>
								<Input
									id="progressModel"
									value={progressModel}
									onChange={(e) => setProgressModel(e.target.value)}
									placeholder="e.g. claude-haiku-3-5"
								/>
								<p className="text-xs text-muted-foreground">
									LLM model used for generating progress summaries. Leave empty to use the project
									default.
								</p>
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
								<p className="text-xs text-muted-foreground">
									How often (in minutes) the agent posts a progress update. Leave empty to use the
									system default.
								</p>
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
							<div>
								<Label htmlFor="runLinksEnabled" className="cursor-pointer">
									Enable run links in comments
								</Label>
								<p className="text-xs text-muted-foreground mt-0.5">
									Adds a dashboard link to agent comments. Requires{' '}
									<code className="text-xs">CASCADE_DASHBOARD_URL</code> env var.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Save / Reset */}
				<div className="flex items-center gap-2">
					<button
						type="submit"
						disabled={updateMutation.isPending || !isDirty}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
					</button>
					<button
						type="button"
						onClick={handleReset}
						disabled={!isDirty}
						className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
					>
						Reset
					</button>
				</div>
			</form>

			{/* API Keys */}
			<Card>
				<CardHeader>
					<CardTitle>API Keys</CardTitle>
					<CardDescription>
						Project-scoped API keys for LLM providers. Values are stored encrypted and never
						returned to the browser. Engine-specific keys are on the{' '}
						<Link
							to="/projects/$projectId/harness"
							params={{ projectId: project.id }}
							className="text-primary hover:underline"
						>
							Harness tab
						</Link>
						.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ProjectSecretField
						projectId={project.id}
						envVarKey="OPENROUTER_API_KEY"
						label="OpenRouter API Key"
						description="API key for OpenRouter LLM routing (progress model). Also used as the engine API key when the OpenCode engine is selected — configure it here or on the Harness tab."
						placeholder="sk-or-..."
						credential={openrouterCred}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
