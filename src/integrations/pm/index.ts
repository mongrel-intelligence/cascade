/**
 * PM provider barrel — side-effect imports register each provider manifest
 * into `pmProviderRegistry` at module load, then mirror each manifest's
 * `pmIntegration` into the cross-category `integrationRegistry` so the
 * agent capability resolver and integration-validation layer can iterate
 * every integration (PM + SCM + alerting) through a single registry.
 *
 * Registration order is preserved: the wizard provider-select dropdown
 * iterates `listPMProviders()` and sees providers in this file's import order.
 */

import { integrationRegistry } from '../registry.js';
import './trello/index.js';
import './jira/index.js';
import './linear/index.js';
import './github-projects/index.js';
import { listPMProviders } from './registry.js';

// Mirror PM manifests into integrationRegistry. Idempotent: guarded by
// integrationRegistry's duplicate-id check semantics — the mirror is a no-op
// on subsequent imports. Plan 006/5 replaces src/integrations/bootstrap.ts
// with this loop.
for (const manifest of listPMProviders()) {
	if (!integrationRegistry.getOrNull(manifest.id)) {
		integrationRegistry.register(manifest.pmIntegration);
	}
}
