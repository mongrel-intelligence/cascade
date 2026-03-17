import type { ComboboxOption } from '@/components/ui/combobox.js';
import { Combobox } from '@/components/ui/combobox.js';
import { Input } from '@/components/ui/input.js';
import { OPENROUTER_PREFIX, addPrefix, modelDetail, modelGroup } from '@/lib/openrouter-utils.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';

interface OpenRouterModelComboboxProps {
	projectId: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	id?: string;
}

/**
 * A searchable combobox that fetches the OpenRouter model catalog from the
 * backend tRPC endpoint and displays models with pricing and context length.
 *
 * - Stores values with the "openrouter:" prefix for disambiguation
 * - Groups models by provider (Anthropic, Google, etc.)
 * - Allows typing an arbitrary model ID ("allowCustom")
 * - Falls back to a plain <Input> on query error
 */
export function OpenRouterModelCombobox({
	projectId,
	value,
	onChange,
	placeholder,
	id,
}: OpenRouterModelComboboxProps) {
	const modelsQuery = useQuery({
		...trpc.projects.openRouterModels.queryOptions({ projectId }),
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// On error, fall back to plain text input
	if (modelsQuery.isError) {
		return (
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder ?? 'Optional'}
			/>
		);
	}

	const models = modelsQuery.data ?? [];

	const options: ComboboxOption[] = models.map((model) => ({
		// Store with prefix so the backend can distinguish from other providers
		value: addPrefix(model.id),
		label: model.name,
		detail: modelDetail(model),
		group: modelGroup(model.id),
	}));

	// The stored value may or may not have the prefix.
	// We always show the full stored value in the combobox trigger for clarity.
	// Both catalog selections (prefixed) and custom typed values are passed through as-is.
	return (
		<Combobox
			id={id}
			value={value}
			onChange={onChange}
			options={options}
			placeholder={modelsQuery.isPending ? 'Loading models…' : 'Search models…'}
			emptyLabel={placeholder ?? 'Optional'}
			allowCustom={true}
		/>
	);
}

// Re-export the prefix constant so callers can reference it without reaching
// into the utilities module directly.
export { OPENROUTER_PREFIX };
