import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Project {
	id: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
}

function numericFieldDefault(value: number | null | undefined): string {
	return value != null ? String(value) : '';
}

export function ProjectHarnessForm({ project }: { project: Project }) {
	const updateMutation = useProjectUpdate(project.id);
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());

	const [model, setModel] = useState(project.model ?? '');
	const [maxIterations, setMaxIterations] = useState(numericFieldDefault(project.maxIterations));
	const [agentEngine, setAgentEngine] = useState(project.agentEngine ?? '');
	const [engineSettings, setEngineSettings] = useState<Record<string, Record<string, unknown>>>(
		project.engineSettings ?? {},
	);

	const effectiveEngineId = agentEngine || '';
	const effectiveEngine = enginesQuery.data?.find((engine) => engine.id === effectiveEngineId);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate({
			model: model || null,
			maxIterations: maxIterations ? Number.parseInt(maxIterations, 10) : null,
			agentEngine: agentEngine || null,
			engineSettings: Object.keys(engineSettings).length > 0 ? engineSettings : null,
		});
	}

	return (
		<form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
			<div className="space-y-2">
				<Label>Agent Engine</Label>
				<Select
					value={agentEngine || '_none'}
					onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select engine" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="_none">None</SelectItem>
						{enginesQuery.data?.map((engine) => (
							<SelectItem key={engine.id} value={engine.id}>
								{engine.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<EngineSettingsFields
				engine={effectiveEngine}
				engines={enginesQuery.data}
				value={engineSettings}
				onChange={(next) => setEngineSettings(next ?? {})}
			/>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="model">Model</Label>
					<ModelField id="model" value={model} onChange={setModel} engine={effectiveEngineId} />
				</div>
				<div className="space-y-2">
					<Label htmlFor="maxIterations">Max Iterations</Label>
					<Input
						id="maxIterations"
						type="number"
						min="1"
						value={maxIterations}
						onChange={(e) => setMaxIterations(e.target.value)}
						placeholder="e.g. 20"
					/>
				</div>
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
	);
}
