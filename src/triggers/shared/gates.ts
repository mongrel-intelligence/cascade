import type { PRDetails } from '../../github/client.js';
import type { PersonaIdentities } from '../../github/personas.js';
import { isCascadeBot } from '../../github/personas.js';
import type { ProjectConfig, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { evaluateAuthorMode } from './author-mode.js';
import { skip } from './skip.js';

/**
 * Composable self-skip gates for trigger handlers.
 *
 * Each gate is a pure function that returns:
 * - `null` — gate passed; handler continues
 * - `TriggerResult` (built via `skip()`) — gate failed; handler should
 *   propagate the structured skip up
 *
 * Compose synchronous gates with the nullish-coalescing operator for the
 * common "fail on first failed gate" pattern:
 *
 * ```ts
 * const skipped =
 *     gateCascadePersona(login, prNumber, personas, this.name) ??
 *     gateBaseBranch(prDetails.baseRef, prNumber, ctx.project, this.name);
 * if (skipped) return skipped;
 * ```
 *
 * Async gates (e.g. database / GitHub API checks) return Promises and must
 * be awaited individually. Sequence them with explicit early returns rather
 * than parallel evaluation when a downstream check would be wasted on a
 * skip.
 */

/**
 * Sync gate: does the PR target the project's configured base branch?
 *
 * Used by `check-suite-failure`, `check-suite-success`, `pr-conflict-detected`.
 * One helper, one log shape, one skip message.
 */
export function gateBaseBranch(
	prBaseRef: string,
	prNumber: number,
	project: ProjectConfig,
	handlerName: string,
): TriggerResult | null {
	if (prBaseRef === project.baseBranch) return null;
	logger.info(`PR targets non-base branch, skipping ${handlerName}`, {
		prNumber,
		baseRef: prBaseRef,
		projectBaseBranch: project.baseBranch,
	});
	return skip(
		handlerName,
		`PR #${prNumber} targets ${prBaseRef}, not project base branch ${project.baseBranch}`,
	);
}

/**
 * Sync gate: was the PR authored by a cascade persona (implementer OR reviewer)?
 *
 * Replaces three previous variants:
 * - manual `=== implementer || === implementer[bot]` (now removed; was the
 *   too-narrow check that hid the ucho/PR#155 incident before being widened)
 * - calling `isCascadeBot(...)` directly with bespoke skip messages
 *
 * Loop-prevention: respond-to-ci, resolve-conflicts, and similar handlers
 * should only auto-fix on PRs the cascade bot personas authored — human PRs
 * are owned by the human.
 *
 * Returns `null` on any failure-to-resolve case (no `personaIdentities`
 * available) — those should be a SEPARATE skip via `gatePersonaIdentities`,
 * with a more specific Sentry-tagged failure surface. This gate ASSUMES
 * `personaIdentities` is defined; pair it with `gatePersonaIdentities` when
 * the handler hasn't already early-returned on missing identities.
 */
export function gateCascadePersona(
	prAuthorLogin: string,
	prNumber: number,
	personaIdentities: PersonaIdentities,
	handlerName: string,
): TriggerResult | null {
	if (isCascadeBot(prAuthorLogin, personaIdentities)) return null;
	logger.info(`PR not authored by a cascade persona, skipping ${handlerName}`, {
		prNumber,
		prAuthor: prAuthorLogin,
	});
	return skip(
		handlerName,
		`PR #${prNumber} not authored by a cascade persona (author: ${prAuthorLogin})`,
	);
}

/**
 * Sync gate: does the PR author match the configured `authorMode` parameter?
 *
 * Delegates to the shared `evaluateAuthorMode` (single source of truth for
 * author-mode logic — MNG-1774). Mirrors `gateCascadePersona`'s signature so it
 * slots into the `??` gate chains, but adds the `parameters` bag carrying the
 * operator's `authorMode` select (own/external/all, default own).
 *
 * Requires a defined `PersonaIdentities` — pair with `requirePersonaIdentities`
 * exactly like `gateCascadePersona`. (When `personaIdentities` is nonetheless
 * undefined, `evaluateAuthorMode` returns null and this gate emits the same
 * persona-resolution skip as the other gates, defense-in-depth.)
 */
export function gateAuthorMode(
	prAuthorLogin: string,
	prNumber: number,
	personaIdentities: PersonaIdentities,
	parameters: Record<string, unknown>,
	handlerName: string,
): TriggerResult | null {
	const result = evaluateAuthorMode(prAuthorLogin, personaIdentities, parameters, handlerName);
	if (!result) {
		return skip(
			handlerName,
			'Cascade persona identities could not be resolved (token / GitHub API issue)',
		);
	}
	if (result.shouldTrigger) return null;
	logger.info(`PR author does not match configured authorMode, skipping ${handlerName}`, {
		prNumber,
		prAuthor: prAuthorLogin,
		authorMode: result.authorMode,
		isCascadePR: result.isCascadePR,
	});
	return skip(
		handlerName,
		`PR #${prNumber} author ${prAuthorLogin} does not match configured authorMode '${result.authorMode}' (isCascadePR=${result.isCascadePR})`,
	);
}

/**
 * Sync gate: does the PR head branch live on the base repo (not a fork)?
 *
 * respond-to-ci and resolve-conflicts *push commits*; CASCADE has no write
 * access to a contributor's fork, so a fork PR would fire → fail at push. This
 * gate turns that into a clean, self-explanatory skip (MNG-1774). Only relevant
 * under `authorMode: external`/`all` — cascade-authored PRs are always
 * same-repo, so `isFork` is false and this is a no-op for `own` mode.
 *
 * `isFork` is optional on `PRDetails` and defaults to non-fork, so callers with
 * older mocks / same-repo PRs pass through unchanged.
 */
export function gateForkWriteAccess(
	prDetails: Pick<PRDetails, 'isFork' | 'headRepoFullName'>,
	prNumber: number,
	handlerName: string,
): TriggerResult | null {
	if (!prDetails.isFork) return null;
	const forkTarget = prDetails.headRepoFullName
		? `fork ${prDetails.headRepoFullName}`
		: 'a deleted/unavailable fork head';
	logger.info(`PR head branch lives on a fork, skipping ${handlerName}`, {
		prNumber,
		headRepoFullName: prDetails.headRepoFullName ?? null,
	});
	return skip(
		handlerName,
		`PR #${prNumber} head branch lives on ${forkTarget} — CASCADE has no write access to push fixes; skipping ${handlerName}`,
	);
}

/**
 * Sync gate: is the handler's per-PR attempt counter under the limit?
 *
 * Used by `check-suite-failure` (MAX_ATTEMPTS = 3) and
 * `pr-conflict-detected` (MAX_ATTEMPTS = 2). Both maintained an in-memory
 * `Map<prNumber, attemptCount>` and used the same counter-check shape.
 *
 * Returns the skip when the limit is hit; the handler is responsible for
 * the side effect of posting a warning comment to the PR (kept handler-side
 * because the comment text differs and is part of the handler's contract).
 */
export function gateAttemptLimit(
	attempts: number,
	maxAttempts: number,
	prNumber: number,
	handlerName: string,
): TriggerResult | null {
	if (attempts < maxAttempts) return null;
	logger.warn(`Max attempts reached for PR — skipping ${handlerName}`, {
		prNumber,
		attempts,
		maxAttempts,
	});
	return skip(
		handlerName,
		`Max auto-fix attempts (${maxAttempts}) reached for PR #${prNumber} — manual intervention required`,
	);
}

/**
 * Type-narrowing variant of a "require this value or skip" gate.
 *
 * - `{ ok: true, value: T }`  → handler proceeds with the narrowed value
 * - `{ ok: false, skip: TriggerResult }` → handler returns the structured skip
 *
 * Differs from the other `gateXxx` helpers because callers need the narrowed
 * value AFTER the gate passes (TypeScript can't infer narrowing across a
 * helper boundary that returns `TriggerResult | null`).
 */
export type RequireGateResult<T> = { ok: true; value: T } | { ok: false; skip: TriggerResult };

/**
 * Require persona identities to be available in the trigger context.
 *
 * Defends every gate that reads `personaIdentities` against the silent
 * `undefined` case (where token resolution failed and the bare-catch in
 * `resolvePersonaCached` left the field unset). `resolvePersonaCached` now
 * Sentry-captures the failure (#1235); this gate's skip message refers to
 * that earlier signal.
 *
 * **Replaces** the prior `gatePersonaIdentities` (which returned plain
 * `TriggerResult | null` and forced callers to use `ctx.personaIdentities!`
 * non-null assertions afterwards). Idiomatic usage:
 *
 * ```ts
 * const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
 * if (!personasResult.ok) return personasResult.skip;
 * const personas = personasResult.value;  // narrowed PersonaIdentities
 * ```
 */
export function requirePersonaIdentities(
	personaIdentities: PersonaIdentities | undefined,
	prNumber: number | undefined,
	handlerName: string,
): RequireGateResult<PersonaIdentities> {
	if (personaIdentities) return { ok: true, value: personaIdentities };
	logger.info(`No persona identities available, skipping ${handlerName}`, { prNumber });
	return {
		ok: false,
		skip: skip(
			handlerName,
			'Cascade persona identities could not be resolved (token / GitHub API issue)',
		),
	};
}
