import { Edit2 } from 'lucide-react';

interface Organization {
	id: string;
	name: string;
}

interface OrganizationsTableProps {
	organizations: Organization[];
	onEdit: (org: Organization) => void;
}

export function OrganizationsTable({ organizations, onEdit }: OrganizationsTableProps) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-muted/50">
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
						<th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
					</tr>
				</thead>
				<tbody>
					{organizations.length === 0 && (
						<tr>
							<td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
								No organizations found
							</td>
						</tr>
					)}
					{organizations.map((org) => (
						<tr key={org.id} className="border-b border-border transition-colors hover:bg-muted/30">
							<td className="px-4 py-3 font-mono text-xs">{org.id}</td>
							<td className="px-4 py-3 font-medium">{org.name}</td>
							<td className="px-4 py-3 text-right">
								<button
									type="button"
									onClick={() => onEdit(org)}
									className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
									title="Edit Organization"
								>
									<Edit2 className="h-4 w-4" />
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
