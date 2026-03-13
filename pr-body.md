## Summary
- Add backend support for listing and managing **all credentials** across all organizations.
- Implement a **Global Credentials** page in the GLOBAL section.
- Update the credentials table to show which organization each secret belongs to.
- Superadmins can now oversee platform secrets globally, edit, and delete them regardless of the organization.

**Card Link:** https://trello.com/c/ycpwJ89s/292-as-a-superadmin-i-want-to-manage-all-credentials-so-that-i-can-oversee-platform-secrets

## Key Changes
### Backend
- Added `listAllCredentials` to `credentialsRepository.ts` to fetch all credentials with organization names.
- Added `listAll` query to `credentialsRouter` protected by `superAdminProcedure`.
- Updated `update` and `delete` in `credentialsRouter` to allow superadmins to manage credentials regardless of the organization.

### Frontend
- Created `GlobalCredentialsPage` in `web/src/routes/global/credentials.tsx`.
- Updated `CredentialsTable` to support an optional `showOrg` prop for displaying organization details.
- Updated `CredentialFormDialog` to invalidate both `list` and `listAll` queries on success.
- Added 'Global Credentials' link to the sidebar for superadmins.

## Testing
- Ran type checks and linting - both passed.
- Verified logic for superadmin access in the API router.
