/**
 * oclif `command_not_found` hook for `cascade-tools` (MNG-1442).
 *
 * When an agent invokes a topic or subcommand that doesn't exist (e.g.
 * `cascade-tools sm get-pr-diff` or `cascade-tools pm reaad-work-item`),
 * oclif's default behavior is to throw `command <id> not found`, which the
 * binary entrypoint terminates with exit code 2. That fallback has no
 * structure, no suggestion, and no candidate list — pre-spec-014 ergonomics
 * the rest of `cascade-tools` has moved past.
 *
 * This hook turns command typos into the same structured envelope every
 * other `cascade-tools` failure emits (spec 014): JSON on stdout, a one-line
 * prose summary on stderr, and a runnable `did you mean` hint when the typo
 * is within the Levenshtein budget. Exit code `2` is preserved — that is
 * oclif's documented `command_not_found` default and existing consumers
 * (including the `bin/cascade-tools.js` catch block) rely on it.
 *
 * **Hook placement.** This file lives under `src/cli/_shared/` because the
 * oclif command-discovery glob in `bin/cascade-tools.js` explicitly excludes
 * `**\/_shared/**`. Without that exclusion, a default-exported function in
 * a discoverable directory would be loaded as a fake top-level command and
 * shadow the hook contract — see `bin/cascade-tools.js` for the glob.
 *
 * **No static import in the entrypoint.** The hook is wired through
 * `pjson.oclif.hooks.command_not_found`, which oclif loads dynamically via
 * `loadWithData` only when the hook actually fires. `bin/cascade-tools.js`
 * therefore keeps its existing friendly `dist/` missing path intact — if
 * `dist/cli/bootstrap.js` is absent, the entrypoint emits the friendly
 * stderr explainer and exits 1 before this module is ever resolved.
 *
 * **Envelope-building delegation.** The pure suggestion logic lives in
 * `./commandSuggestions.ts` (MNG-1441) so it can be unit-tested without
 * booting oclif or installing this hook. This module is a thin wrapper that
 * forwards `{config, id, argv}` into the helper and routes the returned
 * envelope options through `emitCliError` with the documented exit-code-2
 * override.
 */

import type { Hook } from '@oclif/core';

import { emitCliError } from '../../gadgets/shared/errorEnvelope.js';
import { buildUnknownCommandEnvelope, type OclifLikeConfig } from './commandSuggestions.js';

/**
 * Explicit exit delegate that ignores the input code and exits with `2`.
 *
 * `emitCliError` always passes `1` to its exit delegate — the spec-014
 * default for every other CLI failure type (`flag-parse`, `runtime`, etc.).
 * For `unknown-command` we deliberately diverge: `2` is oclif's
 * `command_not_found` default and the cascade-tools entrypoint already
 * forwards it through `process.exit(err.oclif.exit)` for unknown commands.
 * Keeping the same exit code on the structured-envelope path avoids
 * regressing any tooling that branches on the historical 2 vs other codes.
 */
const exitWithCode2: (code: number) => never = () => process.exit(2);

const commandNotFoundHook: Hook<'command_not_found'> = async (opts) => {
	const envelopeOpts = buildUnknownCommandEnvelope({
		// oclif's full Config carries dozens of fields the helper does not
		// consume. `OclifLikeConfig` declares the narrow subset (bin,
		// commandIDs, pjson.oclif.topics) the helper needs, so a structural
		// cast through `unknown` is safe and avoids dragging the full Config
		// dependency through the helper module.
		config: opts.config as unknown as OclifLikeConfig,
		id: opts.id,
		argv: opts.argv,
	});
	emitCliError({
		...envelopeOpts,
		exit: exitWithCode2,
	});
};

export default commandNotFoundHook;
