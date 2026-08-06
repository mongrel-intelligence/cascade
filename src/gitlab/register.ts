/**
 * GitLab SCM integration — side-effect module that self-registers into
 * `integrationRegistry` at module load.
 *
 * Mirrors `src/github/register.ts`. SCM integrations remain on the legacy
 * `IntegrationModule` registration pattern — the manifest pattern is PM-only
 * (spec 006 scope).
 */

import { integrationRegistry } from '../integrations/registry.js';
import { GitLabSCMIntegration } from './scm-integration.js';

if (!integrationRegistry.getOrNull('gitlab')) {
	integrationRegistry.register(new GitLabSCMIntegration());
}
