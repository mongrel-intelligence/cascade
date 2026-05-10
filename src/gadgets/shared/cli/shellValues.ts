const SHELL_SAFE_VALUE_PATTERN = /^[A-Za-z0-9_./:@%+=,-]+$/;

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatShellScalar(value: unknown): string {
	const rendered = String(value);
	if (rendered.length > 0 && SHELL_SAFE_VALUE_PATTERN.test(rendered)) {
		return rendered;
	}
	return shellQuote(rendered);
}

export function formatJsonExample(value: unknown): string | undefined {
	try {
		return shellQuote(JSON.stringify(value));
	} catch {
		// JSON.stringify throws on cyclic refs. Tool definition examples should
		// never be cyclic, but prompt/help rendering should not crash if one is.
		return undefined;
	}
}
