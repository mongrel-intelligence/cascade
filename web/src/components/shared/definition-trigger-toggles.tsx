import { Badge } from '@/components/ui/badge.js';
import { TriggerParameterInput } from './trigger-parameter-input.js';

// Re-export the ResolvedTrigger type from shared location
export type { ResolvedTrigger } from '../../../../src/api/routers/_shared/triggerTypes.js';

import type {
	ResolvedTrigger,
	TriggerParameterValue,
} from '../../../../src/api/routers/_shared/triggerTypes.js';

interface Props {
	triggers: ResolvedTrigger[];
	onToggle: (event: string, enabled: boolean) => void;
	onParamChange: (event: string, parameters: Record<string, TriggerParameterValue>) => void;
	idPrefix?: string;
	disabled?: boolean;
}

/**
 * Renders trigger toggles from agent definitions with support for parameters.
 * Uses the definition-based trigger format from getProjectTriggersView.
 */
export function DefinitionTriggerToggles({
	triggers,
	onToggle,
	onParamChange,
	idPrefix,
	disabled,
}: Props) {
	if (triggers.length === 0) return null;

	return (
		<div className="space-y-3">
			{triggers.map((trigger) => {
				const htmlId = `trigger-${idPrefix ? `${idPrefix}-` : ''}${trigger.event}`;
				const hasParams = trigger.parameterDefs.length > 0;

				return (
					<div key={trigger.event} className="space-y-2">
						<div className="flex items-start gap-3">
							<input
								type="checkbox"
								id={htmlId}
								checked={trigger.enabled}
								onChange={(e) => onToggle(trigger.event, e.target.checked)}
								disabled={disabled}
								className="mt-0.5 h-4 w-4 rounded border-input"
								aria-describedby={trigger.description ? `${htmlId}-desc` : undefined}
							/>
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<label htmlFor={htmlId} className="text-sm font-medium cursor-pointer">
										{trigger.label}
									</label>
									{trigger.isCustomized && (
										<Badge variant="outline" className="text-xs py-0 h-4">
											customized
										</Badge>
									)}
								</div>
								{trigger.description && (
									<p id={`${htmlId}-desc`} className="text-xs text-muted-foreground">
										{trigger.description}
									</p>
								)}
							</div>
						</div>

						{/* Render parameters inline when trigger is enabled and has params */}
						{hasParams && trigger.enabled && (
							<div className="ml-7 pl-3 border-l border-border space-y-2">
								{trigger.parameterDefs.map((param) => (
									<TriggerParameterInput
										key={param.name}
										parameter={param}
										value={trigger.parameters[param.name]}
										onChange={(newValue) => {
											onParamChange(trigger.event, {
												...trigger.parameters,
												[param.name]: newValue,
											});
										}}
										disabled={disabled}
									/>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
