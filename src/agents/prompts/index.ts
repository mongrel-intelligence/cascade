import { BRIEFING_SYSTEM_PROMPT } from './briefing.js';
import { IMPLEMENTATION_SYSTEM_PROMPT } from './implementation.js';
import { PLANNING_SYSTEM_PROMPT } from './planning.js';

export { BRIEFING_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT, IMPLEMENTATION_SYSTEM_PROMPT };

export function getSystemPrompt(agentType: string): string {
	switch (agentType) {
		case 'briefing':
			return BRIEFING_SYSTEM_PROMPT;
		case 'planning':
			return PLANNING_SYSTEM_PROMPT;
		case 'implementation':
			return IMPLEMENTATION_SYSTEM_PROMPT;
		default:
			throw new Error(`Unknown agent type: ${agentType}`);
	}
}
