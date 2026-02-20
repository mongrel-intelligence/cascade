import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { KNOWN_AGENT_TYPES } from '@/lib/trigger-agent-mapping.js';
import { Link } from '@tanstack/react-router';

/**
 * Agent type selector with support for custom types.
 * Shared between project-scoped and global agent config dialogs.
 */
export function AgentTypeSelect({
	value,
	customValue,
	onValueChange,
	onCustomChange,
	id,
}: {
	value: string;
	customValue: string;
	onValueChange: (v: string) => void;
	onCustomChange: (v: string) => void;
	/** Optional id for the select trigger element */
	id?: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>Agent Type</Label>
			<Select value={value} onValueChange={onValueChange}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder="Select agent type..." />
				</SelectTrigger>
				<SelectContent>
					{KNOWN_AGENT_TYPES.map((type) => (
						<SelectItem key={type} value={type}>
							{type}
						</SelectItem>
					))}
					<SelectItem value="_custom">Other (custom type)</SelectItem>
				</SelectContent>
			</Select>
			{value === '_custom' && (
				<Input
					value={customValue}
					onChange={(e) => onCustomChange(e.target.value)}
					placeholder="Custom agent type name"
					required
				/>
			)}
		</div>
	);
}

/**
 * Backend selector (llmist / claude-code / none).
 * Shared between project-scoped and global agent config dialogs.
 */
export function BackendSelect({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label>Backend</Label>
			<Select value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder="Optional" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="_none">None (use default)</SelectItem>
					<SelectItem value="llmist">llmist</SelectItem>
					<SelectItem value="claude-code">claude-code</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

/**
 * Prompt information display with link to prompt editor.
 * Shared between project-scoped and global agent config dialogs.
 */
export function PromptInfo({ hasPrompt }: { hasPrompt?: boolean }) {
	return (
		<div className="space-y-2">
			<Label>Prompt</Label>
			{hasPrompt ? (
				<p className="text-sm text-muted-foreground">
					Custom prompt set.{' '}
					<Link to="/settings/prompts" className="text-primary hover:underline">
						Edit in Prompt Editor
					</Link>
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Using default.{' '}
					<Link to="/settings/prompts" className="text-primary hover:underline">
						Customize in Prompt Editor
					</Link>
				</p>
			)}
		</div>
	);
}

/**
 * Resolve initial agent type state from an existing config.
 * Returns separate values for the select and custom input.
 */
export function resolveInitialAgentType(agentType?: string): {
	agentType: string;
	customAgentType: string;
} {
	if (!agentType) return { agentType: '', customAgentType: '' };
	const isKnown = (KNOWN_AGENT_TYPES as readonly string[]).includes(agentType);
	return {
		agentType: isKnown ? agentType : '_custom',
		customAgentType: isKnown ? '' : agentType,
	};
}
