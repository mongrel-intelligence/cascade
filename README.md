# CASCADE

Multi-project Trello-to-code automation platform. CASCADE reacts to Trello card movements and triggers AI agents to handle splitting, planning, and implementation tasks.

## Features

- **Multi-project support** - Single deployment handles multiple repos/Trello boards
- **Extensible trigger system** - Easy to add new triggers (card moved, label added, PR ready, etc.)
- **AI-powered agents** - Splitting, planning, implementation, review, and debug agents using llmist
- **Git workflow** - Automatic branch creation, commits, and PR creation
- **Trello integration** - Full card management (labels, comments, attachments)
- **GitHub integration** - PR review webhooks, automatic card movement, CI check monitoring

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Git
- GitHub CLI (`gh`) - for PR creation

### Installation

```bash
# Clone the repository
git clone https://github.com/zbigniewsobiecki/cascade.git
cd cascade

# Install dependencies
npm install

# Install git hooks
npx lefthook install

# Copy environment template
cp .env.example .env
```

### Environment Variables

Edit `.env` with your credentials:

```bash
# Required for Trello integration
TRELLO_API_KEY=your_trello_api_key
TRELLO_TOKEN=your_trello_token

# Required for GitHub dual-persona model
GITHUB_TOKEN_IMPLEMENTER=your_implementer_bot_token
GITHUB_TOKEN_REVIEWER=your_reviewer_bot_token

# Required for AI agents (via OpenRouter)
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional
PORT=3000
LOG_LEVEL=info
CONFIG_PATH=./config/projects.json
```

#### Getting Trello Credentials

1. Get your API key: https://trello.com/app-key
2. Generate a token using the link on that page
3. Find board/list/label IDs:
   - Open a Trello board
   - Add `.json` to the URL (e.g., `https://trello.com/b/BOARD_ID.json`)
   - Search for list names to find their IDs

#### Getting GitHub Token

```bash
# Using GitHub CLI
gh auth token

# Or create a Personal Access Token at:
# https://github.com/settings/tokens
# Required scopes: repo, workflow
```

## Configuration

### Project Configuration

Edit `config/projects.json` to add your projects:

```json
{
  "defaults": {
    "model": "openrouter:google/gemini-3-flash-preview",
    "maxIterations": 50,
    "selfDestructTimeoutMs": 1800000
  },
  "projects": [
    {
      "id": "my-project",
      "name": "My Project",
      "repo": "owner/repo-name",
      "baseBranch": "main",
      "branchPrefix": "feature/",
      "trello": {
        "boardId": "your_board_id",
        "lists": {
          "splitting": "list_id_for_splitting",
          "planning": "list_id_for_planning",
          "todo": "list_id_for_todo",
          "inProgress": "list_id_for_in_progress",
          "inReview": "list_id_for_in_review"
        },
        "labels": {
          "readyToProcess": "label_id_ready",
          "processing": "label_id_processing",
          "processed": "label_id_processed",
          "error": "label_id_error"
        }
      }
    }
  ]
}
```

### Trello Lists

| List | Purpose |
|------|---------|
| `splitting` | Cards here trigger the splitting agent (splits plan into work items) |
| `planning` | Cards here trigger the planning agent (creates implementation plan) |
| `todo` | Cards here trigger the implementation agent (writes code, creates PR) |
| `inProgress` | Cards being actively worked on |
| `inReview` | Cards with PRs ready for review |

### Trello Labels

| Label | Purpose |
|-------|---------|
| `readyToProcess` | Card is ready for agent processing |
| `processing` | Agent is currently working on the card |
| `processed` | Agent completed successfully |
| `error` | Agent encountered an error |

## Development

### Commands

```bash
# Start development server (with hot reload)
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Lint
npm run lint

# Lint and fix
npm run lint:fix

# Build for production
npm run build

# Start production server
npm start
```

### Project Structure

```
cascade/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Hono HTTP server
│   ├── config/               # Configuration loading & validation
│   ├── triggers/             # Extensible trigger system
│   │   ├── registry.ts       # TriggerRegistry
│   │   ├── types.ts          # Trigger interfaces
│   │   └── trello/           # Trello-specific triggers
│   ├── agents/               # AI agents
│   │   ├── registry.ts       # Agent registry
│   │   ├── base.ts           # Base agent runner
│   │   └── prompts/          # System prompts
│   ├── gadgets/              # Agent tools
│   │   ├── trello/           # Trello API gadgets
│   │   └── git/              # Git operation gadgets
│   ├── trello/               # Trello client
│   ├── utils/                # Utilities
│   └── types/                # TypeScript types
├── tests/                    # Test files
├── config/                   # Project configurations
└── ...
```

## Adding New Triggers

The trigger system is extensible. To add a new trigger:

```typescript
// src/triggers/custom/my-trigger.ts
import type { TriggerHandler, TriggerContext, TriggerResult } from '../types.js';

export class MyCustomTrigger implements TriggerHandler {
  name = 'my-custom-trigger';
  description = 'Triggers when something happens';

  matches(ctx: TriggerContext): boolean {
    // Return true if this trigger should handle the context
    return ctx.source === 'trello' && /* your condition */;
  }

  async handle(ctx: TriggerContext): Promise<TriggerResult> {
    return {
      agentType: 'implementation', // or 'splitting', 'planning'
      agentInput: { /* data for the agent */ },
      cardId: 'optional-card-id',
    };
  }
}

// Register in src/triggers/index.ts
registry.register(new MyCustomTrigger());
```

## Deployment

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly apps create cascade

# Set secrets
fly secrets set \
  TRELLO_API_KEY="..." \
  TRELLO_TOKEN="..." \
  GITHUB_TOKEN_IMPLEMENTER="..." \
  GITHUB_TOKEN_REVIEWER="..." \
  OPENROUTER_API_KEY="..."

# Deploy
fly deploy
```

### Trello Webhook Setup

After deployment, set up the Trello webhook:

```bash
# Get your Trello callback URL
CALLBACK_URL="https://api.ca.sca.de.com/trello/webhooks"

# Create webhook for each board
curl -X POST "https://api.trello.com/1/webhooks" \
  -d "key=${TRELLO_API_KEY}" \
  -d "token=${TRELLO_TOKEN}" \
  -d "callbackURL=${CALLBACK_URL}" \
  -d "idModel=${BOARD_ID}" \
  -d "description=Cascade webhook"
```

### GitHub Webhook Setup

Set up GitHub webhooks for your repository to enable PR review triggers:

1. Go to your repository settings: `https://github.com/owner/repo/settings/hooks`
2. Click "Add webhook"
3. Configure:
   - **Payload URL**: `https://api.ca.sca.de.com/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: (optional, not currently validated)
   - **Events**: Select individual events:
     - Pull request review comments
     - Pull request reviews
     - Check suites
4. Click "Add webhook"

**Supported GitHub Triggers**:
- **PR Review Comments**: Triggers review agent when someone comments on a PR review
- **PR Review Submissions**: Triggers review agent when someone submits a PR review (approve/request changes)
- **Check Suite Failures**: Triggers review agent to fix failed CI checks
- **PR Ready to Merge**: Auto-moves card to DONE when all checks pass and PR is approved

**Note**: GitHub webhooks only trigger for PRs that have a Trello card URL in their description.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/health` | HEAD | Health check (no body) |
| `/trello/webhooks` | POST | Trello webhook receiver |
| `/trello/webhooks` | HEAD | Trello webhook verification |
| `/github/webhook` | POST | GitHub webhook receiver |
| `/github/webhook` | GET | GitHub webhook verification |

## License

MIT
