import { Button } from '@/components/ui/button.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';

interface EngineSettingFieldOption {
	value: string;
	label: string;
}

type EngineSettingField =
	| {
			key: string;
			label: string;
			type: 'select';
			description?: string;
			options: EngineSettingFieldOption[];
	  }
	| {
			key: string;
			label: string;
			type: 'boolean';
			description?: string;
	  };

interface EngineDefinition {
	id: string;
	label: string;
	settings?: {
		title?: string;
		description?: string;
		fields: EngineSettingField[];
	};
}

interface EngineSettingsFieldsProps {
	engine?: EngineDefinition;
	engines?: EngineDefinition[];
	value?: Record<string, Record<string, unknown> | undefined>;
	onChange: (value: Record<string, Record<string, unknown> | undefined> | undefined) => void;
	inheritLabel?: string;
}

function normalizeValue(
	value?: Record<string, Record<string, unknown> | undefined>,
): Record<string, Record<string, unknown> | undefined> | undefined {
	if (!value) return undefined;
	return Object.keys(value).length > 0 ? value : undefined;
}

function formatSettingValue(value: unknown): string {
	if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

export function EngineSettingsFields({
	engine,
	engines,
	value,
	onChange,
	inheritLabel = 'Inherits from defaults',
}: EngineSettingsFieldsProps) {
	const activeEngineValues =
		(engine && (value?.[engine.id] as Record<string, unknown> | undefined)) ?? {};
	const engineMap = new Map((engines ?? []).map((candidate) => [candidate.id, candidate] as const));
	const inactiveEngineEntries = Object.entries(value ?? {}).filter(
		([engineId, engineValues]) =>
			engineId !== engine?.id && engineValues && Object.keys(engineValues).length > 0,
	);

	function updateField(key: string, nextValue: unknown) {
		if (!engine) return;

		const nextEngineValues = { ...activeEngineValues };
		if (nextValue === undefined) {
			delete nextEngineValues[key];
		} else {
			nextEngineValues[key] = nextValue;
		}

		const nextSettings = { ...(value ?? {}) };
		if (Object.keys(nextEngineValues).length === 0) {
			delete nextSettings[engine.id];
		} else {
			nextSettings[engine.id] = nextEngineValues;
		}

		onChange(normalizeValue(nextSettings));
	}

	function clearEngine(engineId: string) {
		const nextSettings = { ...(value ?? {}) };
		delete nextSettings[engineId];
		onChange(normalizeValue(nextSettings));
	}

	if (!engine?.settings && inactiveEngineEntries.length === 0) return null;

	return (
		<div className="space-y-4">
			{engine?.settings && (
				<div className="rounded-lg border border-border p-4 space-y-4">
					<div>
						<h3 className="text-sm font-medium">
							{engine.settings.title ?? `${engine.label} Settings`}
						</h3>
						{engine.settings.description && (
							<p className="text-xs text-muted-foreground mt-1">{engine.settings.description}</p>
						)}
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{engine.settings.fields.map((field) => {
							const rawValue = activeEngineValues[field.key];

							return (
								<div key={field.key} className="space-y-2">
									<Label>{field.label}</Label>
									{field.type === 'select' ? (
										<Select
											value={typeof rawValue === 'string' ? rawValue : '_default'}
											onValueChange={(next) =>
												updateField(field.key, next === '_default' ? undefined : next)
											}
										>
											<SelectTrigger className="w-full">
												<SelectValue placeholder={inheritLabel} />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="_default">{inheritLabel}</SelectItem>
												{field.options.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : (
										<Select
											value={
												typeof rawValue === 'boolean' ? (rawValue ? 'true' : 'false') : '_default'
											}
											onValueChange={(next) =>
												updateField(field.key, next === '_default' ? undefined : next === 'true')
											}
										>
											<SelectTrigger className="w-full">
												<SelectValue placeholder={inheritLabel} />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="_default">{inheritLabel}</SelectItem>
												<SelectItem value="true">Enabled</SelectItem>
												<SelectItem value="false">Disabled</SelectItem>
											</SelectContent>
										</Select>
									)}
									{field.description && (
										<p className="text-xs text-muted-foreground">{field.description}</p>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{inactiveEngineEntries.length > 0 && (
				<div className="rounded-lg border border-border p-4 space-y-3">
					<div>
						<h3 className="text-sm font-medium">Retained Engine Settings</h3>
						<p className="text-xs text-muted-foreground mt-1">
							These settings are stored for other engines and will apply again if you switch back.
						</p>
					</div>

					<div className="space-y-3">
						{inactiveEngineEntries.map(([engineId, engineValues]) => {
							const retainedEngine = engineMap.get(engineId);
							const fields = retainedEngine?.settings?.fields ?? [];

							return (
								<div
									key={engineId}
									className="rounded-md border border-border/70 bg-muted/20 px-3 py-3 space-y-2"
								>
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="text-sm font-medium">{retainedEngine?.label ?? engineId}</p>
											<p className="text-xs text-muted-foreground">{engineId}</p>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => clearEngine(engineId)}
										>
											Clear
										</Button>
									</div>
									<div className="space-y-1">
										{Object.entries(engineValues).map(([key, rawValue]) => {
											const field = fields.find((candidate) => candidate.key === key);
											return (
												<p key={key} className="text-xs text-muted-foreground">
													<span className="font-medium text-foreground">{field?.label ?? key}</span>{' '}
													{formatSettingValue(rawValue)}
												</p>
											);
										})}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
