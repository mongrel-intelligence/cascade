import { Edit2 } from 'lucide-react';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';

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
		<div className="rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow className="bg-muted/50 hover:bg-muted/50">
						<TableHead className="px-4 py-3">ID</TableHead>
						<TableHead className="px-4 py-3">Name</TableHead>
						<TableHead className="px-4 py-3 text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{organizations.length === 0 && (
						<TableRow>
							<TableCell
								colSpan={3}
								className="px-4 py-8 text-center whitespace-normal text-muted-foreground"
							>
								No organizations found
							</TableCell>
						</TableRow>
					)}
					{organizations.map((org) => (
						<TableRow key={org.id}>
							<TableCell className="px-4 py-3 font-mono text-xs">{org.id}</TableCell>
							<TableCell className="px-4 py-3 font-medium">{org.name}</TableCell>
							<TableCell className="px-4 py-3 text-right">
								<button
									type="button"
									onClick={() => onEdit(org)}
									className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
									title="Edit Organization"
								>
									<Edit2 className="h-4 w-4" />
								</button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
