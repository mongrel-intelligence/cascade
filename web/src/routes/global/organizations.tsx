import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { OrganizationFormDialog } from '@/components/global/organization-form-dialog.js';
import { OrganizationsTable } from '@/components/global/organizations-table.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

interface Organization {
	id: string;
	name: string;
}

function GlobalOrganizationsPage() {
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [editingOrg, setEditingOrg] = useState<Organization | null>(null);

	const orgsQuery = useQuery(trpc.organization.list.queryOptions());

	function handleEdit(org: Organization) {
		setEditingOrg(org);
		setIsDialogOpen(true);
	}

	function handleCreate() {
		setEditingOrg(null);
		setIsDialogOpen(true);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
				<button
					type="button"
					onClick={handleCreate}
					className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					New Organization
				</button>
			</div>

			{orgsQuery.isLoading && (
				<div className="py-8 text-center text-muted-foreground">Loading organizations...</div>
			)}

			{orgsQuery.isError && (
				<div className="py-8 text-center text-destructive">
					Failed to load organizations: {orgsQuery.error.message}
				</div>
			)}

			{orgsQuery.data && <OrganizationsTable organizations={orgsQuery.data} onEdit={handleEdit} />}

			<OrganizationFormDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				organization={editingOrg}
			/>
		</div>
	);
}

export const globalOrganizationsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/global/organizations',
	component: GlobalOrganizationsPage,
});
