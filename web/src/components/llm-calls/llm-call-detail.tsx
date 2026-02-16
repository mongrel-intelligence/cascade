import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface LlmCallDetailProps {
	runId: string;
	callNumber: number;
}

type DetailTab = 'request' | 'response';

export function LlmCallDetail({ runId, callNumber }: LlmCallDetailProps) {
	const [tab, setTab] = useState<DetailTab>('response');

	const callQuery = useQuery(trpc.runs.getLlmCall.queryOptions({ runId, callNumber }));

	if (callQuery.isLoading) {
		return <div className="p-4 text-sm text-muted-foreground">Loading call detail...</div>;
	}

	if (!callQuery.data) {
		return <div className="p-4 text-sm text-destructive">Failed to load call</div>;
	}

	const content = tab === 'request' ? callQuery.data.request : callQuery.data.response;

	let formattedContent: string;
	try {
		formattedContent = content ? JSON.stringify(JSON.parse(content), null, 2) : 'No content';
	} catch {
		formattedContent = content ?? 'No content';
	}

	return (
		<div className="border-t border-border bg-muted/10 p-4">
			<div className="mb-3 flex gap-2">
				{(['request', 'response'] as const).map((t) => (
					<button
						type="button"
						key={t}
						onClick={() => setTab(t)}
						className={cn(
							'rounded-md px-3 py-1 text-xs font-medium transition-colors',
							tab === t
								? 'bg-primary text-primary-foreground'
								: 'bg-muted text-muted-foreground hover:bg-muted/80',
						)}
					>
						{t}
					</button>
				))}
			</div>
			<pre className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5">
				{formattedContent}
			</pre>
		</div>
	);
}
