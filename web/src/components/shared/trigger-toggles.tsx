import { Label } from '@/components/ui/label.js';
import {
	type TriggerDef,
	getMultiSelectValue,
	getTriggerValue,
	setMultiSelectValue,
	setTriggerValue,
} from '@/lib/trigger-agent-mapping.js';

export type { TriggerDef };

function optionLabel(option: string): string {
	if (option === 'own') return 'Own PRs (implementer-authored)';
	if (option === 'all') return 'All PRs';
	if (option === 'reviewRequested') return 'Review Requested';
	return option;
}

/**
 * Renders a list of trigger toggle checkboxes.
 * Supports both flat keys (e.g., "cardMovedToBriefing") and nested dot-notation
 * keys (e.g., "readyToProcessLabel.briefing").
 * When inputType === 'multi-select', renders one checkbox per option in item.options,
 * storing the value as an array in the triggers record.
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
				const htmlId = `trigger-${idPrefix ? `${idPrefix}-` : ''}${item.key}`;

				if (item.inputType === 'multi-select' && item.options) {
					// Multi-select: render one checkbox per option
					const selected = getMultiSelectValue(values, item.key);
					return (
						<div key={item.key} className="space-y-2">
							<div>
								<span className="text-sm font-medium">{item.label}</span>
								<p className="text-xs text-muted-foreground">{item.description}</p>
							</div>
							<div className="ml-1 space-y-1.5">
								{item.options.map((option) => {
									const optionId = `${htmlId}-${option}`;
									const checked = selected.includes(option);
									return (
										<div key={option} className="flex items-center gap-2">
											<input
												type="checkbox"
												id={optionId}
												checked={checked}
												onChange={(e) =>
													onChange(setMultiSelectValue(values, item.key, option, e.target.checked))
												}
												className="h-4 w-4 rounded border-input"
											/>
											<label htmlFor={optionId} className="text-sm cursor-pointer">
												{optionLabel(option)}
											</label>
										</div>
									);
								})}
							</div>
						</div>
					);
				}

				// Standard checkbox
				const value = getTriggerValue(values, item.key, item.defaultValue);
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
