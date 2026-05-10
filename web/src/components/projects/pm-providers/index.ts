/**
 * Frontend PM provider barrel — side-effect imports register each provider's
 * wizard definition into `providerWizardRegistry` at module load.
 *
 * This mirrors the backend barrel at `src/integrations/pm/index.ts`. The
 * single import of this module in `pm-wizard.tsx` ensures every provider is
 * registered before the wizard renders.
 *
 * Adding a new PM provider? Add exactly one line here:
 *   import './<provider>/index.js';
 *
 * No other shared file needs to change — `pm-wizard.tsx` imports this barrel
 * and never needs to be edited for a new provider.
 */

import './trello/index.js';
import './jira/index.js';
import './linear/index.js';
