/**
 * GitHub Projects frontend provider barrel.
 * Side-effect: registers the wizard definition with the global registry.
 */

import { registerProviderWizard } from '../registry.js';
import { githubProjectsProviderWizard } from './wizard.js';

registerProviderWizard(githubProjectsProviderWizard);

export * from './state.js';
export { githubProjectsProviderWizard };
