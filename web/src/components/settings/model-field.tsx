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
	backend: string;
	id?: string;
}

export function ModelField({ value, onChange, backend, id }: ModelFieldProps) {
	const modelsQuery = useQuery(trpc.agentConfigs.claudeCodeModels.queryOptions());

	if (backend === 'claude-code') {
		return (
			<Select value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder="Select model" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="_none">Default (Sonnet 4.5)</SelectItem>
					{modelsQuery.data?.map((m) => (
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
			placeholder="Optional"
		/>
	);
}
