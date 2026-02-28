import { trpc } from '@/lib/trpc.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface LogViewerProps {
	runId: string;
}

type LogTab = 'cascade' | 'llmist';

export function LogViewer({ runId }: LogViewerProps) {
	const logsQuery = useQuery(trpc.runs.getLogs.queryOptions({ runId }));
	const [activeTab, setActiveTab] = useState<LogTab>('cascade');

	if (logsQuery.isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading logs...</div>;
	}

	if (logsQuery.isError) {
		return <div className="py-8 text-center text-destructive">Failed to load logs</div>;
	}

	const data = logsQuery.data;
	if (!data) {
		return (
			<div className="py-8 text-center text-muted-foreground">No logs available for this run</div>
		);
	}

	const logContent = activeTab === 'cascade' ? data.cascadeLog : data.llmistLog;
	const tabs: { id: LogTab; label: string }[] = [
		{ id: 'cascade', label: 'Cascade Log' },
		{ id: 'llmist', label: 'LLMist Log' },
	];

	return (
		<div className="space-y-3">
			<div className="flex gap-2">
				{tabs.map((tab) => (
					<button
						type="button"
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
							activeTab === tab.id
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						{tab.label}
					</button>
				))}
			</div>
			<div className="overflow-hidden rounded-lg border border-border">
				{logContent ? (
					<pre className="max-h-[600px] overflow-auto bg-black/90 p-4 font-mono text-xs text-neutral-300 whitespace-pre-wrap">
						{logContent}
					</pre>
				) : (
					<div className="py-8 text-center text-muted-foreground">No {activeTab} log available</div>
				)}
			</div>
		</div>
	);
}
