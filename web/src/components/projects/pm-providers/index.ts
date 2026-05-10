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
 * Shared orchestration files (`pm-wizard.tsx`, `pm-wizard-hooks.ts`,
 * `pm-wizard-common-steps.tsx`) need zero edits after this import.
 * The one shared dashboard file that still requires manual edits is
 * `pm-wizard-state.ts` — new providers must add their credential fields
 * to `WizardState`, the corresponding action types to `WizardAction`, and
 * `buildEditState` handling for their config shape.  See step 4 of
 * "Adding a new PM provider" in src/integrations/README.md.
 */

import './trello/index.js';
import './jira/index.js';
import './linear/index.js';
