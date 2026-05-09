import { emitCliError } from '../errorEnvelope.js';
import type { ErrorSink } from './errorSink.js';

function normalizeBoolValue(raw: string): boolean | null {
	const lc = raw.toLowerCase();
	if (lc === 'true' || lc === 'yes' || lc === '1') return true;
	if (lc === 'false' || lc === 'no' || lc === '0') return false;
	return null;
}

/**
 * Pre-process argv so boolean flags accept the natural value form.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: argv-shape taxonomy (--key=value, --key value, bare toggle)
export function massageBooleanFlagValues(
	argv: readonly string[] | undefined,
	booleanFlags: ReadonlyMap<string, boolean>,
	sink: ErrorSink,
): string[] | undefined {
	if (argv === undefined) return undefined;
	if (booleanFlags.size === 0) return [...argv];
	const result: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];

		if (tok.startsWith('--') && tok.includes('=')) {
			const eqIdx = tok.indexOf('=');
			const name = tok.slice(2, eqIdx);
			if (booleanFlags.has(name)) {
				const allowNo = booleanFlags.get(name) ?? false;
				const value = tok.slice(eqIdx + 1);
				const normalized = normalizeBoolValue(value);
				if (normalized === true) {
					result.push(`--${name}`);
					continue;
				}
				if (normalized === false) {
					if (allowNo) result.push(`--no-${name}`);
					continue;
				}
				emitCliError({
					type: 'flag-parse',
					flag: name,
					message: `Boolean flag --${name} got value '${value}'; accepts true|false|yes|no|1|0`,
					got: value,
					expected: 'true|false|yes|no|1|0',
					hint: allowNo
						? `Use --${name} or --no-${name} for the canonical toggle form, or --${name}=true / --${name}=false.`
						: `Use --${name} for true, or omit the flag for false.`,
					stdout: sink.stdout,
					stderr: sink.stderr,
					exit: sink.exit,
				});
			}
		}

		if (tok.startsWith('--') && !tok.includes('=')) {
			const name = tok.slice(2);
			if (booleanFlags.has(name) && i + 1 < argv.length) {
				const allowNo = booleanFlags.get(name) ?? false;
				const next = argv[i + 1];
				const normalized = normalizeBoolValue(next);
				if (normalized === true) {
					result.push(`--${name}`);
					i++;
					continue;
				}
				if (normalized === false) {
					if (allowNo) result.push(`--no-${name}`);
					i++;
					continue;
				}
				if (!next.startsWith('--')) {
					emitCliError({
						type: 'flag-parse',
						flag: name,
						message: `Boolean flag --${name} got value '${next}'; accepts true|false|yes|no|1|0`,
						got: next,
						expected: 'true|false|yes|no|1|0',
						hint: allowNo
							? `Use --${name} or --no-${name} for the canonical toggle form.`
							: `Use --${name} for true, or omit the flag for false.`,
						stdout: sink.stdout,
						stderr: sink.stderr,
						exit: sink.exit,
					});
				}
			}
		}
		result.push(tok);
	}
	return result;
}
