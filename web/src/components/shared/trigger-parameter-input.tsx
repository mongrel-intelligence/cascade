import { Input } from '@/components/ui/input.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';

// Re-export types from shared location for convenience
export type {
	TriggerParameterDef,
	TriggerParameterValue,
} from '../../../../src/api/routers/_shared/triggerTypes.js';

import type {
	TriggerParameterDef,
	TriggerParameterValue,
} from '../../../../src/api/routers/_shared/triggerTypes.js';

interface Props {
	parameter: TriggerParameterDef;
	value: TriggerParameterValue | undefined;
	onChange: (value: TriggerParameterValue) => void;
	disabled?: boolean;
}

/**
 * Renders an input widget for a trigger parameter based on its type.
 * Supports string, email, boolean, select, and number types.
 */
export function TriggerParameterInput({ parameter, value, onChange, disabled }: Props) {
	// Helper to get the current value with fallback to default
	const getCurrentValue = <T,>(fallback: T): T => {
		if (value !== undefined) return value as T;
		if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
			return parameter.defaultValue as T;
		}
		return fallback;
	};

	switch (parameter.type) {
		case 'boolean':
			return (
				<div className="flex items-center gap-2">
					<input
						type="checkbox"
						id={`param-${parameter.name}`}
						checked={getCurrentValue(false)}
						onChange={(e) => onChange(e.target.checked)}
						disabled={disabled}
						className="h-4 w-4 rounded border-input"
					/>
					<label htmlFor={`param-${parameter.name}`} className="text-sm cursor-pointer">
						{parameter.label}
					</label>
					{parameter.description && (
						<span className="text-xs text-muted-foreground">({parameter.description})</span>
					)}
				</div>
			);

		case 'select':
			return (
				<div className="space-y-1">
					<label htmlFor={`param-${parameter.name}`} className="text-xs font-medium">
						{parameter.label}
						{parameter.required && <span className="text-destructive ml-0.5">*</span>}
					</label>
					<Select value={getCurrentValue('')} onValueChange={onChange} disabled={disabled}>
						<SelectTrigger id={`param-${parameter.name}`} className="w-full h-8 text-sm">
							<SelectValue placeholder="Select..." />
						</SelectTrigger>
						<SelectContent>
							{parameter.options && parameter.options.length > 0 ? (
								parameter.options.map((opt) => (
									<SelectItem key={opt} value={opt}>
										{opt}
									</SelectItem>
								))
							) : (
								<SelectItem value="" disabled>
									No options available
								</SelectItem>
							)}
						</SelectContent>
					</Select>
					{parameter.description && (
						<p className="text-xs text-muted-foreground">{parameter.description}</p>
					)}
				</div>
			);

		case 'number':
			return (
				<div className="space-y-1">
					<label htmlFor={`param-${parameter.name}`} className="text-xs font-medium">
						{parameter.label}
						{parameter.required && <span className="text-destructive ml-0.5">*</span>}
					</label>
					<Input
						id={`param-${parameter.name}`}
						type="number"
						value={getCurrentValue('')}
						onChange={(e) => {
							const num = e.target.value === '' ? 0 : Number(e.target.value);
							onChange(num);
						}}
						placeholder={parameter.description ?? undefined}
						disabled={disabled}
						className="h-8 text-sm"
					/>
					{parameter.description && (
						<p className="text-xs text-muted-foreground">{parameter.description}</p>
					)}
				</div>
			);

		// 'email' and 'string' types (and any unknown type) render a text input
		default:
			return (
				<div className="space-y-1">
					<label htmlFor={`param-${parameter.name}`} className="text-xs font-medium">
						{parameter.label}
						{parameter.required && <span className="text-destructive ml-0.5">*</span>}
					</label>
					<Input
						id={`param-${parameter.name}`}
						type={parameter.type === 'email' ? 'email' : 'text'}
						value={getCurrentValue('')}
						onChange={(e) => onChange(e.target.value)}
						placeholder={parameter.description ?? undefined}
						disabled={disabled}
						className="h-8 text-sm"
					/>
					{parameter.description && (
						<p className="text-xs text-muted-foreground">{parameter.description}</p>
					)}
				</div>
			);
	}
}
