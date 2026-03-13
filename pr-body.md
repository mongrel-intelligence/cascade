## Summary
Implemented a new Global Runs page and backend support for cross-organization run monitoring, available exclusively to superadmins.

### Backend Changes
- **Runs Repository:** Updated `listRuns` to join with the `organizations` table and make `orgId` filtering optional.
- **Runs Router:** Added `listAll` procedure (superadmin-only) and updated `getById`, `trigger`, `retry`, and `cancel` to allow superadmin access regardless of organization.
- **Projects Repository:** Added `listAllProjects` to support global project filtering.
- **Projects Router:** Added `listAll` procedure for superadmins.

### Frontend Changes
- **Global Runs Page:** New route at `/global/runs` showing activity from all organizations.
- **Runs Table:** Added `showOrg` prop to conditionally display the Organization column.
- **Run Filters:** Updated to support an external `projects` list for global filtering.
- **Sidebar:** Added a 'Global Runs' link under the Global section for superadmins.

### Verification
- Unit tests added/updated for repository and router changes.
- Type checking passes for both backend and frontend.
- Frontend build verified.

Trello Card: https://trello.com/c/xJwATsrd/291-as-a-superadmin-i-want-to-view-all-runs-across-the-platform-so-that-i-can-monitor-system-activity
