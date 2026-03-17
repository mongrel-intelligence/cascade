/**
 * OpenRouter API types
 * https://openrouter.ai/docs/api-reference/list-available-models
 */

export interface OpenRouterModelPricing {
	/** Cost per token (as a decimal string, e.g. "0.0000015") */
	prompt: string;
	completion: string;
}

export interface OpenRouterModelArchitecture {
	modality: string; // e.g. "text->text", "text+image->text"
	tokenizer?: string;
	instruct_type?: string | null;
}

/** Raw model shape returned from OpenRouter /api/v1/models */
export interface OpenRouterRawModel {
	id: string;
	name: string;
	description?: string;
	context_length?: number;
	architecture?: OpenRouterModelArchitecture;
	pricing?: OpenRouterModelPricing;
	top_provider?: { max_completion_tokens?: number | null };
}

export interface OpenRouterModelsResponse {
	data: OpenRouterRawModel[];
}

/** Minimal model shape for the dashboard */
export interface OpenRouterModel {
	id: string;
	name: string;
	contextLength: number | null;
	maxOutput: number | null;
	pricing: {
		/** Cost per million input tokens in USD */
		inputPerMillion: number;
		/** Cost per million output tokens in USD */
		outputPerMillion: number;
	};
}
