/**
 * Sleep gadget - pause execution for a specified duration.
 *
 * Use this when you need to wait for:
 * - Processes to start up (dev servers, databases, etc.)
 * - Rate limiting between API calls
 * - External systems to become ready
 */
import { Gadget, z } from 'llmist';

export class Sleep extends Gadget({
	name: 'Sleep',
	description: `Pause execution for a specified number of seconds.

**Use cases:**
- Wait for a dev server to start after \`Tmux(action="start")\`
- Rate limiting between API calls
- Give external processes time to initialize

**Guidelines:**
- Keep waits short (1-10 seconds typically)
- After sleeping, verify the expected state (e.g., capture tmux output)
- Don't use for long waits (>30s) - prefer polling with shorter sleeps`,
	timeoutMs: 65000, // Allow up to 60s sleep + 5s buffer
	schema: z.object({
		seconds: z.number().min(0.1).max(60).describe('Duration to sleep in seconds (0.1 to 60)'),
		reason: z.string().optional().describe('Optional reason for the wait (for logging clarity)'),
	}),
	examples: [
		{
			params: { seconds: 3, reason: 'waiting for dev server to start' },
			output: 'Slept for 3 seconds (waiting for dev server to start)',
			comment: 'Wait for a dev server after starting it with tmux',
		},
		{
			params: { seconds: 1 },
			output: 'Slept for 1 second',
			comment: 'Brief pause between operations',
		},
		{
			params: { seconds: 5, reason: 'database initialization' },
			output: 'Slept for 5 seconds (database initialization)',
			comment: 'Wait for database to be ready',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		const { seconds, reason } = params;

		// Sleep for the specified duration
		await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

		const duration = seconds === 1 ? '1 second' : `${seconds} seconds`;
		const reasonText = reason ? ` (${reason})` : '';

		return `Slept for ${duration}${reasonText}`;
	}
}
