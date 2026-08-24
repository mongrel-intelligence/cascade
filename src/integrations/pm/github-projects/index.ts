/**
 * GitHub Projects PM provider — side-effect module that registers the manifest.
 */

import { registerPMProvider } from '../registry.js';
import { githubProjectsManifest } from './manifest.js';

registerPMProvider(githubProjectsManifest);

export { githubProjectsManifest };
