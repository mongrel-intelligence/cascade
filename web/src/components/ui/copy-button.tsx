import { Check, Clipboard } from 'lucide-react';
import { useState } from 'react';

/**
 * Compact copy-to-clipboard button with a `Copy` → `Copied` state toggle.
 *
 * Extracted from `integration-scm-tab.tsx` where it previously lived as a
 * local `export function CopyButton` imported cross-file by
 * `integration-alerting-tab.tsx`. Now a proper shared UI primitive:
 * additional consumers in the PM wizard path
 * (`pm-providers/steps/webhook-url-display.tsx`, the Trello/JIRA curl
 * fallbacks) import from here.
 */
export function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			data-slot="copy-button"
			data-action="copy-to-clipboard"
			className="inline-flex items-center gap-1 shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
			title="Copy to clipboard"
		>
			{copied ? <Check className="h-3 w-3 text-green-600" /> : <Clipboard className="h-3 w-3" />}
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}
