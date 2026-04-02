/**
 * Shared types, constants, and helper components for the agent definition editor.
 * Extracted from agent-definition-editor.tsx to serve as the foundational leaf
 * of the import graph — this file must NOT import from any sibling agent-definition-* file.
 */

import type { inferRouterOutputs } from '@trpc/server';
import { Info } from 'lucide-react';
import type { AppRouter } from '@/../../src/api/router.js';
import type { KnownTriggerEvent } from '@/../../src/api/routers/_shared/triggerTypes.js';
import { Badge } from '@/components/ui/badge.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';

// ─────────────────────────────────────────────────────────────────────────────
// Type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type RouterOutput = inferRouterOutputs<AppRouter>;
export type DefinitionRow = RouterOutput['agentDefinitions']['list'][number];
export type AgentDefinition = DefinitionRow['definition'];
export type Capability = AgentDefinition['capabilities']['required'][number];

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaData {
	capabilities: readonly string[];
	triggerRegistry: Record<string, KnownTriggerEvent[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** All available capabilities organized by integration */
export const CAPABILITY_GROUPS: Record<string, { label: string; caps: Capability[] }> = {
	'built-in': {
		label: 'Built-in (always available)',
		caps: ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl'],
	},
	pm: {
		label: 'PM Integration (Trello/JIRA)',
		caps: ['pm:read', 'pm:write', 'pm:checklist'],
	},
	scm: {
		label: 'SCM Integration (GitHub)',
		caps: ['scm:read', 'scm:comment', 'scm:review', 'scm:pr'],
	},
};

/** Default empty definition used for "create" mode */
export const EMPTY_DEFINITION: AgentDefinition = {
	identity: { emoji: '🤖', label: '', roleHint: '', initialMessage: '' },
	capabilities: {
		required: ['fs:read', 'session:ctrl'],
		optional: [],
	},
	triggers: [],
	strategies: {},
	hint: '',
	prompts: {
		taskPrompt:
			'Analyze and process the work item with ID: <%= it.workItemId %>. The work item data has been pre-loaded.',
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immutably set a deeply nested key in an object.
 * e.g. deepSet({}, ['trailing', 'scm', 'gitStatus'], true)
 */
export function deepSet(
	obj: Record<string, unknown>,
	path: string[],
	value: unknown,
): Record<string, unknown> {
	if (path.length === 0) return obj;
	const [head, ...rest] = path;
	return {
		...obj,
		[head]:
			rest.length === 0
				? value
				: deepSet((obj[head] ?? {}) as Record<string, unknown>, rest, value),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

export function InfoTooltip({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
					<Info className="h-3.5 w-3.5" />
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">{text}</TooltipContent>
		</Tooltip>
	);
}

export function Toggle({
	checked,
	onChange,
	label,
	description,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
	description?: string;
}) {
	return (
		<div className="flex cursor-pointer select-none items-center gap-2">
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
					checked ? 'bg-primary' : 'bg-input'
				}`}
			>
				<span
					className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
						checked ? 'translate-x-4.5' : 'translate-x-0.5'
					}`}
				/>
			</button>
			<span className="text-sm">{label}</span>
			{description && <InfoTooltip text={description} />}
		</div>
	);
}

export function MultiSelectBadges({
	available,
	selected,
	onChange,
}: {
	available: readonly string[];
	selected: string[];
	onChange: (v: string[]) => void;
}) {
	const toggle = (item: string) => {
		if (selected.includes(item)) {
			onChange(selected.filter((s) => s !== item));
		} else {
			onChange([...selected, item]);
		}
	};
	return (
		<div className="flex flex-wrap gap-1.5">
			{available.map((item) => (
				<button
					key={item}
					type="button"
					onClick={() => toggle(item)}
					className="focus:outline-none"
				>
					<Badge
						variant={selected.includes(item) ? 'default' : 'outline'}
						className="cursor-pointer text-xs hover:opacity-80"
					>
						{item}
					</Badge>
				</button>
			))}
		</div>
	);
}

// Re-export TooltipProvider for consumers that need to wrap InfoTooltip usage
export { TooltipProvider };
