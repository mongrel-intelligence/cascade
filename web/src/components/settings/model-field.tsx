import { Input } from '@/components/ui/input.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface ModelFieldProps {
	value: string;
	onChange: (value: string) => void;
	engine: string;
	id?: string;
	/** Placeholder text for free-text mode (e.g. the resolved default model name).
	 *  Defaults to "Optional" when not provided. */
	defaultLabel?: string;
}

export function ModelField({ value, onChange, engine, id, defaultLabel }: ModelFieldProps) {
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());
	const engineDefinition = enginesQuery.data?.find((item) => item.id === engine);

	if (engineDefinition?.modelSelection.type === 'select') {
		return (
			<Select value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder="Select model" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="_none">{engineDefinition.modelSelection.defaultValueLabel}</SelectItem>
					{engineDefinition.modelSelection.options.map((m) => (
						<SelectItem key={m.value} value={m.value}>
							{m.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	return (
		<Input
			id={id}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={defaultLabel ?? 'Optional'}
		/>
	);
}
