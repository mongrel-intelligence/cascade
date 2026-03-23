import { type ParsedBlock, parseLlmResponse } from '@/lib/llm-response-parser.js';
import { getToolStyle } from '@/lib/tool-style.js';
import { trpc } from '@/lib/trpc.js';
import { formatCost } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface LlmCallDetailProps {
	runId: string;
	callNumber: number;
}

interface MetaItem {
	label: string;
	mono?: boolean;
}

function TextBlock({ text }: { text: string }) {
	return (
		<div className="rounded-md bg-muted/30 p-3 text-sm whitespace-pre-wrap leading-relaxed">
			{text}
		</div>
	);
}

function ToolUseBlock({ name, inputSummary }: { name: string; inputSummary: string }) {
	const { bg, text } = getToolStyle(name);
	return (
		<div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
			<span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${bg} ${text}`}>
				{name}
			</span>
			{inputSummary && (
				<code className="min-w-0 break-all font-mono text-xs text-muted-foreground">
					{inputSummary}
				</code>
			)}
		</div>
	);
}

function ThinkingBlock({ text }: { text: string }) {
	return (
		<details className="rounded-md border border-border/50">
			<summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
				Thinking ({text.length.toLocaleString()} chars)
			</summary>
			<pre className="px-3 pb-3 pt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
				{text}
			</pre>
		</details>
	);
}

function ParsedBlockList({ blocks }: { blocks: ParsedBlock[] }) {
	return (
		<div className="space-y-2">
			{blocks.map((block, i) => {
				const key = `${i}-${block.kind}`;
				if (block.kind === 'text') return <TextBlock key={key} text={block.text} />;
				if (block.kind === 'tool_use')
					return <ToolUseBlock key={key} name={block.name} inputSummary={block.inputSummary} />;
				if (block.kind === 'thinking') return <ThinkingBlock key={key} text={block.text} />;
				return null;
			})}
		</div>
	);
}

function formatRawContent(response: string | null | undefined): string {
	if (!response) return 'No content';
	try {
		return JSON.stringify(JSON.parse(response), null, 2);
	} catch {
		return response;
	}
}

function buildMetaItems(call: {
	model?: string | null;
	createdAt?: Date | string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedTokens?: number | null;
	costUsd?: string | null;
}): MetaItem[] {
	const items: MetaItem[] = [];
	if (call.model) items.push({ label: call.model, mono: true });
	if (call.createdAt) {
		const timeStr = new Date(call.createdAt).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
		items.push({ label: timeStr });
	}
	const tokenParts: string[] = [];
	if (call.inputTokens != null) tokenParts.push(`${call.inputTokens.toLocaleString()} in`);
	if (call.outputTokens != null) tokenParts.push(`${call.outputTokens.toLocaleString()} out`);
	if (tokenParts.length > 0) items.push({ label: tokenParts.join(' / ') });
	if (call.cachedTokens && call.cachedTokens > 0)
		items.push({ label: `+${call.cachedTokens.toLocaleString()} cached` });
	const costStr = formatCost(call.costUsd);
	if (costStr !== '—') items.push({ label: costStr });
	return items;
}

export function LlmCallDetail({ runId, callNumber }: LlmCallDetailProps) {
	const [showRaw, setShowRaw] = useState(false);

	const callQuery = useQuery(trpc.runs.getLlmCall.queryOptions({ runId, callNumber }));

	if (callQuery.isLoading) {
		return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
	}

	if (callQuery.isError || !callQuery.data) {
		return <div className="p-4 text-sm text-destructive">Failed to load call</div>;
	}

	const call = callQuery.data;
	const parsed = parseLlmResponse(call.response);
	const hasContent = parsed.blocks.length > 0;
	const metaItems = buildMetaItems(call);

	return (
		<div className="border-t border-border bg-muted/10 p-4 space-y-3">
			{/* Metadata bar */}
			{metaItems.length > 0 && (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{metaItems.map((item) => (
						<span key={item.label} className={item.mono ? 'font-mono' : undefined}>
							{item.label}
						</span>
					))}
				</div>
			)}

			{/* Raw toggle */}
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">Content</span>
				<button
					type="button"
					onClick={() => setShowRaw((v) => !v)}
					className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
				>
					{showRaw ? 'Structured' : 'Raw'}
				</button>
			</div>

			{showRaw ? (
				<pre className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5">
					{formatRawContent(call.response)}
				</pre>
			) : !hasContent ? (
				<div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground italic">
					No response payload stored for this engine.
				</div>
			) : (
				<ParsedBlockList blocks={parsed.blocks} />
			)}
		</div>
	);
}
