import { Label } from '@/components/ui/label.js';
import { type TriggerDef, getTriggerValue, setTriggerValue } from '@/lib/trigger-agent-mapping.js';

export type { TriggerDef };

/**
 * Renders a list of trigger toggle checkboxes.
 * Supports both flat keys (e.g., "cardMovedToBriefing") and nested dot-notation
 * keys (e.g., "readyToProcessLabel.briefing").
 */
export function TriggerToggles({
	title,
	items,
	values,
	onChange,
	idPrefix,
}: {
	title?: string;
	items: TriggerDef[];
	values: Record<string, unknown>;
	onChange: (values: Record<string, unknown>) => void;
	idPrefix?: string;
}) {
	if (items.length === 0) return null;

	return (
		<div className="space-y-3">
			{title && <Label className="text-sm font-medium">{title}</Label>}
			{items.map((item) => {
				const value = getTriggerValue(values, item.key, item.defaultValue);
				const htmlId = `trigger-${idPrefix ? `${idPrefix}-` : ''}${item.key}`;
				return (
					<div key={item.key} className="flex items-start gap-3">
						<input
							type="checkbox"
							id={htmlId}
							checked={value}
							onChange={(e) => onChange(setTriggerValue(values, item.key, e.target.checked))}
							className="mt-0.5 h-4 w-4 rounded border-input"
						/>
						<div>
							<label htmlFor={htmlId} className="text-sm font-medium cursor-pointer">
								{item.label}
							</label>
							<p className="text-xs text-muted-foreground">{item.description}</p>
						</div>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Legacy adapter: accepts flat `Record<string, boolean>` values map for backward
 * compatibility with the original integration-form.tsx usage.
 */
export function TriggerTogglesFlatCompat({
	title,
	items,
	values,
	onChange,
}: {
	title: string;
	items: Array<{ key: string; label: string; description: string; defaultValue: boolean }>;
	values: Record<string, boolean>;
	onChange: (values: Record<string, boolean>) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div className="space-y-3">
			<Label className="text-sm font-medium">{title}</Label>
			{items.map((item) => {
				const value = item.key in values ? values[item.key] : item.defaultValue;
				return (
					<div key={item.key} className="flex items-start gap-3">
						<input
							type="checkbox"
							id={`trigger-flat-${item.key}`}
							checked={value}
							onChange={(e) => onChange({ ...values, [item.key]: e.target.checked })}
							className="mt-0.5 h-4 w-4 rounded border-input"
						/>
						<div>
							<label
								htmlFor={`trigger-flat-${item.key}`}
								className="text-sm font-medium cursor-pointer"
							>
								{item.label}
							</label>
							<p className="text-xs text-muted-foreground">{item.description}</p>
						</div>
					</div>
				);
			})}
		</div>
	);
}
