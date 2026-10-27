#!/usr/bin/env node
/**
 * Production-dependency security gate for CI.
 *
 * Runs `npm audit --omit=dev --audit-level=high` and fails on any high/critical
 * advisory EXCEPT those explicitly allowlisted below. Each allowlist entry must
 * reference the remediation story that tracks it, because the gate audits
 * against the *live* GitHub advisory database (see friction MNG-1801): newly
 * published advisories can start failing unrelated PRs and the `dev` branch at
 * any time, and some have no in-scope, non-breaking fix.
 *
 * Allowlisting is deliberately narrow — it keys on specific GHSA IDs, so any
 * *new* high/critical advisory still fails the gate.
 */

import { execFileSync } from 'node:child_process';

/**
 * GHSA IDs that are known, tracked, and intentionally deferred.
 * Keep this list as small as possible and remove entries as fixes land.
 */
const ALLOWLIST = new Map([
	[
		'GHSA-mrhx-c7xc-m3w5',
		// zod <4.6.6 — the only fix is zod@4.6.7, a semver-major 3->4 bump. The
		// root and web/ workspaces must share one zod major (repo-hygiene
		// invariant) and src/config/schema.ts uses zod-3 APIs (single-arg
		// z.record), so this requires the dedicated Zod migration story, not a
		// dependency patch. Tracked alongside MNG-1796 / MNG-1801.
		'zod <4.6.6 — deferred to the Zod 3->4 migration story',
	],
]);

const GATING = new Set(['high', 'critical']);

function runAudit() {
	try {
		const out = execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
		return JSON.parse(out);
	} catch (err) {
		// `npm audit` exits non-zero when advisories are found; the JSON report is
		// still on stdout, so parse that rather than treating it as a hard failure.
		if (err && typeof err.stdout === 'string' && err.stdout.trim()) {
			return JSON.parse(err.stdout);
		}
		throw err;
	}
}

function advisoryId(via) {
	if (typeof via !== 'object' || !via.url) return null;
	return via.url.split('/advisories/')[1] || null;
}

function collectGatingAdvisories(report) {
	const found = new Map(); // GHSA id -> { title, severity }
	const vulns = Object.values(report.vulnerabilities ?? {}).filter((v) => GATING.has(v.severity));
	for (const vuln of vulns) {
		for (const via of vuln.via ?? []) {
			const id = advisoryId(via);
			if (id) {
				found.set(id, { title: via.title ?? id, severity: via.severity ?? vuln.severity });
			}
		}
	}
	return found;
}

const report = runAudit();
const advisories = collectGatingAdvisories(report);

const blocking = [...advisories].filter(([id]) => !ALLOWLIST.has(id));
const deferred = [...advisories].filter(([id]) => ALLOWLIST.has(id));

if (deferred.length > 0) {
	console.log('Allowlisted (deferred) high/critical advisories:');
	for (const [id, info] of deferred) {
		console.log(`  - ${id} [${info.severity}] ${info.title}`);
		console.log(`      reason: ${ALLOWLIST.get(id)}`);
	}
}

if (blocking.length > 0) {
	console.error('\nBlocking high/critical production advisories (not allowlisted):');
	for (const [id, info] of blocking) {
		console.error(`  - ${id} [${info.severity}] ${info.title}`);
	}
	console.error('\nFix the advisory or, if it is intentionally deferred, add it to the');
	console.error('ALLOWLIST in .github/scripts/audit-prod-deps.mjs with a tracking reference.');
	process.exit(1);
}

console.log('\nProduction dependency audit passed (no non-allowlisted high/critical advisories).');
