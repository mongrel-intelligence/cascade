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
	inheritLabel?: string;
}

function normalizeValue(
	value?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
	if (!value) return undefined;
	return Object.keys(value).length > 0 ? value : undefined;
}

interface FieldInputProps {
	field: EngineSettingField;
	rawValue: unknown;
	inheritLabel: string;
	onChange: (value: unknown) => void;
}

function FieldInput({ field, rawValue, inheritLabel, onChange }: FieldInputProps) {
	if (field.type === 'select') {
		return (
			<Select
				value={typeof rawValue === 'string' ? rawValue : '_default'}
				onValueChange={(next) => onChange(next === '_default' ? undefined : next)}
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
				min={1}
				value={typeof rawValue === 'number' ? String(rawValue) : ''}
				onChange={(e) => {
					const parsed = e.target.value ? Number(e.target.value) : undefined;
					onChange(parsed);
				}}
				placeholder={inheritLabel}
			/>
		);
	}

	// boolean
	return (
		<Select
			value={typeof rawValue === 'boolean' ? (rawValue ? 'true' : 'false') : '_default'}
			onValueChange={(next) => onChange(next === '_default' ? undefined : next === 'true')}
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
					{engine.settings.fields.map((field) => (
						<div key={field.key} className="space-y-2">
							<Label>{field.label}</Label>
							<FieldInput
								field={field}
								rawValue={activeEngineValues[field.key]}
								inheritLabel={inheritLabel}
								onChange={(v) => updateField(field.key, v)}
							/>
							{field.description && (
								<p className="text-xs text-muted-foreground">{field.description}</p>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
