import { Input } from '@/components/ui/input.js';
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
	  }
	| {
			key: string;
			label: string;
			type: 'number';
			description?: string;
			min?: number;
			max?: number;
			step?: number;
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
	value?: Record<string, Record<string, unknown>>;
	onChange: (value: Record<string, Record<string, unknown>> | undefined) => void;
	/** @deprecated Use engineDefaults instead. */
	inheritLabel?: string;
	/** Per-field default values for the active engine. When provided, labels
	 *  like "Default (High)" are derived from these values instead of using
	 *  the generic "Inherits from defaults" text. */
	engineDefaults?: Record<string, unknown>;
}

function normalizeValue(
	value?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
	if (!value) return undefined;
	return Object.keys(value).length > 0 ? value : undefined;
}

/**
 * Derive a human-readable label for a field's default value.
 * Falls back to the generic inheritLabel when no default is found.
 */
function resolveInheritLabel(
	field: EngineSettingField,
	engineDefaults: Record<string, unknown> | undefined,
	fallback: string,
): string {
	if (!engineDefaults) return fallback;
	const defaultVal = engineDefaults[field.key];
	if (defaultVal === undefined || defaultVal === null) return fallback;

	if (field.type === 'select') {
		const option = field.options.find((o) => o.value === String(defaultVal));
		return option ? `Default (${option.label})` : fallback;
	}

	if (field.type === 'boolean') {
		return defaultVal ? 'Default (Enabled)' : 'Default (Disabled)';
	}

	// number
	return `Default (${defaultVal})`;
}

interface FieldControlProps {
	field: EngineSettingField;
	rawValue: unknown;
	inheritLabel: string;
	onUpdate: (key: string, value: unknown) => void;
}

function FieldControl({ field, rawValue, inheritLabel, onUpdate }: FieldControlProps) {
	if (field.type === 'select') {
		return (
			<Select
				value={typeof rawValue === 'string' ? rawValue : '_default'}
				onValueChange={(next) => onUpdate(field.key, next === '_default' ? undefined : next)}
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
		);
	}

	if (field.type === 'number') {
		return (
			<Input
				type="number"
				min={field.min}
				max={field.max}
				step={field.step}
				placeholder={inheritLabel}
				value={typeof rawValue === 'number' ? rawValue : ''}
				onChange={(e) => {
					const trimmed = e.target.value.trim();
					if (trimmed === '') {
						onUpdate(field.key, undefined);
					} else {
						const parsed = Number(trimmed);
						if (!Number.isNaN(parsed)) {
							onUpdate(field.key, parsed);
						}
					}
				}}
			/>
		);
	}

	// boolean
	return (
		<Select
			value={typeof rawValue === 'boolean' ? (rawValue ? 'true' : 'false') : '_default'}
			onValueChange={(next) =>
				onUpdate(field.key, next === '_default' ? undefined : next === 'true')
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
	);
}

export function EngineSettingsFields({
	engine,
	value,
	onChange,
	inheritLabel = 'Inherits from defaults',
	engineDefaults,
}: EngineSettingsFieldsProps) {
	const activeEngineValues =
		(engine && (value?.[engine.id] as Record<string, unknown> | undefined)) ?? {};

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

	if (!engine?.settings) return null;

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
							const fieldInheritLabel = resolveInheritLabel(field, engineDefaults, inheritLabel);
							return (
								<div key={field.key} className="space-y-2">
									<Label>{field.label}</Label>
									<FieldControl
										field={field}
										rawValue={activeEngineValues[field.key]}
										inheritLabel={fieldInheritLabel}
										onUpdate={updateField}
									/>
									{field.description && (
										<p className="text-xs text-muted-foreground">{field.description}</p>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
