import { type ParsedBlock, parseLlmResponse } from '@/lib/llm-response-parser.js';
import { getToolStyle } from '@/lib/tool-style.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface LlmCallDetailProps {
	runId: string;
	callNumber: number;
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
		<div className="rounded-md border border-border/50 overflow-hidden">
			<div className="px-3 py-2 text-xs text-muted-foreground bg-muted/20">
				💭 Thinking ({text.length.toLocaleString()} chars)
			</div>
			<pre className="px-3 pb-3 pt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
				{text}
			</pre>
		</div>
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

export function LlmCallDetail({ runId, callNumber }: LlmCallDetailProps) {
	const [showRaw, setShowRaw] = useState(true);

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

	return (
		<div className="border-t border-border bg-muted/10 p-4 space-y-3">
			{/* Raw / Structured toggle */}
			<div className="flex items-center justify-end">
				<button
					type="button"
					onClick={() => setShowRaw((v) => !v)}
					className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
				>
					{showRaw ? 'Structured' : 'Raw'}
				</button>
			</div>

			{showRaw ? (
				// Raw view keeps max-h-96 as a compact scrollable JSON representation.
				// The structured view intentionally shows all content fully expanded (no truncation).
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
