# CASCADE - Trello-to-Code Automation Platform

## Quick Start

```bash
npm install
npm run dev
```

## Architecture

CASCADE reacts to Trello webhooks and runs AI agents to analyze, plan, and implement features.

### Trigger System

The extensible trigger system routes events to agents:

```
Trello/GitHub Webhook → TriggerRegistry → Agent → Code Changes → PR
```

- `src/triggers/` - Event handlers (Trello card moves, labels, GitHub PRs)
- `src/agents/` - AI agents (briefing, planning, implementation, review)
- `src/gadgets/` - Tools agents can use (Trello API, Git operations, file system)

### Multi-Project Support

Configure multiple projects in `config/projects.json`:

```json
{
  "projects": [
    {
      "id": "my-project",
      "repo": "owner/repo",
      "trello": {
        "boardId": "...",
        "lists": { "briefing": "...", "planning": "...", "todo": "..." }
      }
    }
  ]
}
```

## Development

### Testing

```bash
npm test                 # Run tests
npm run test:coverage    # Run with coverage
npm run test:watch       # Watch mode
```

### Linting

```bash
npm run lint             # Check
npm run lint:fix         # Fix
npm run typecheck        # Type check
```

### Git Hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (test) hooks automatically.

## Key Directories

- `src/config/` - Project configuration and Zod schemas
- `src/triggers/` - Extensible trigger system (Trello, GitHub)
- `src/agents/` - AI agent implementations
- `src/gadgets/` - Custom gadgets (Trello, Git)
- `src/trello/` - Trello API client
- `src/utils/` - Utilities (logging, repo cloning, lifecycle)

## Environment Variables

Required:
- `TRELLO_API_KEY`, `TRELLO_TOKEN` - Trello API credentials
- `GITHUB_TOKEN` - For cloning repos and creating PRs
- `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` - LLM provider

Optional:
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `CONFIG_PATH` - Path to projects config file

## Adding New Triggers

1. Create trigger handler in `src/triggers/`
2. Implement `TriggerHandler` interface
3. Register in `src/triggers/index.ts`

## Adding New Agents

1. Create agent in `src/agents/`
2. Define system prompt in `src/agents/prompts/`
3. Register in agent registry
