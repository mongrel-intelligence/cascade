import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet.js';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Sidebar } from './sidebar.js';

interface MobileSidebarProps {
	user: { name: string; email: string; role: string } | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function MobileSidebar({ user, open, onOpenChange }: MobileSidebarProps) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	// Auto-close on route navigation
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the trigger; onOpenChange is stable
	useEffect(() => {
		onOpenChange(false);
	}, [pathname]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="left"
				className="p-0 w-56"
				showCloseButton={false}
				aria-label="Navigation menu"
			>
				<SheetTitle className="sr-only">Navigation menu</SheetTitle>
				<Sidebar user={user} />
			</SheetContent>
		</Sheet>
	);
}
