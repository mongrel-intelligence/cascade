import type { ComboboxOption } from '@/components/ui/combobox.js';
import { Combobox } from '@/components/ui/combobox.js';
import { Input } from '@/components/ui/input.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import type { OpenRouterModel } from '../../../../src/openrouter/types.js';

/** Prefix used to store OpenRouter model IDs */
const OPENROUTER_PREFIX = 'openrouter:';

function stripPrefix(value: string): string {
	return value.startsWith(OPENROUTER_PREFIX) ? value.slice(OPENROUTER_PREFIX.length) : value;
}

function addPrefix(id: string): string {
	return id.startsWith(OPENROUTER_PREFIX) ? id : `${OPENROUTER_PREFIX}${id}`;
}

function formatPrice(n: number): string {
	if (n === 0) return 'free';
	if (n < 0.01) return `$${n.toFixed(4)}/M`;
	return `$${n.toFixed(2)}/M`;
}

function formatContext(n: number | null): string {
	if (n == null) return '';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M ctx`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K ctx`;
	return `${n} ctx`;
}

function modelDetail(model: OpenRouterModel): string {
	const parts: string[] = [];
	const ctxStr = formatContext(model.contextLength);
	if (ctxStr) parts.push(ctxStr);
	const inStr = formatPrice(model.pricing.inputPerMillion);
	const outStr = formatPrice(model.pricing.outputPerMillion);
	parts.push(`in:${inStr} out:${outStr}`);
	return parts.join(' · ');
}

/**
 * Extracts the provider name from an OpenRouter model id.
 * E.g. "anthropic/claude-3-5-sonnet" → "Anthropic"
 */
function modelGroup(modelId: string): string {
	const slash = modelId.indexOf('/');
	if (slash === -1) return 'Other';
	const provider = modelId.slice(0, slash);
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}

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

	// Strip the prefix for the display value so users see a clean model name
	function handleChange(newValue: string) {
		// If user picked from list → value already has prefix
		// If user typed a custom value → apply prefix
		if (newValue.startsWith(OPENROUTER_PREFIX)) {
			onChange(newValue);
		} else {
			// Custom typed value — store as-is (no prefix) to allow passing
			// arbitrary model IDs for non-OpenRouter use cases
			onChange(newValue);
		}
	}

	// The stored value may or may not have the prefix.
	// We always show the full stored value in the combobox trigger for clarity.
	return (
		<Combobox
			id={id}
			value={value}
			onChange={handleChange}
			options={options}
			placeholder={modelsQuery.isPending ? 'Loading models…' : 'Search models…'}
			emptyLabel={placeholder ?? 'Optional'}
			allowCustom={true}
		/>
	);
}
