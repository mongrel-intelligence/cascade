import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';

export class CreateTrelloCard extends Gadget({
	name: 'CreateTrelloCard',
	description:
		'Create a new Trello card in a specific list. Use this to create user story cards or break down work into smaller tasks.',
	timeoutMs: 30000,
	schema: z.object({
		listId: z.string().describe('The Trello list ID where the card should be created'),
		title: z
			.string()
			.max(200)
			.describe(
				'Card title. For user stories, use format: "As a [role], I want [action] so that [benefit]"',
			),
		description: z
			.string()
			.optional()
			.describe(
				'Card description (markdown supported). Include acceptance criteria and technical notes.',
			),
	}),
	examples: [
		{
			params: {
				listId: 'abc123',
				title: 'As a user, I want to reset my password so that I can recover my account',
				description:
					'## Acceptance Criteria\n\n- [ ] User can request password reset via email\n- [ ] Reset link expires after 24 hours\n- [ ] User must set a new password meeting security requirements\n\n## Technical Notes\n\n- Use existing email service\n- Store reset tokens in database with expiry',
			},
			comment: 'Create an INVEST-compatible user story card',
		},
		{
			params: {
				listId: 'abc123',
				title: 'Add email validation to signup form',
				description:
					'## Acceptance Criteria\n\n- [ ] Email format is validated on blur\n- [ ] Error message is shown for invalid emails',
			},
			comment: 'Create a simple task card',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const card = await trelloClient.createCard(params.listId, {
				name: params.title,
				desc: params.description,
			});

			return `Card created successfully: "${card.name}" - ${card.shortUrl}`;
		} catch (error) {
			return `Error creating card: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
