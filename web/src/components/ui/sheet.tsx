import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="sheet-overlay"
			className={cn(
				'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
				className,
			)}
			{...props}
		/>
	);
}

const sheetSideVariants: Record<string, string> = {
	left: 'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
	right:
		'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
	top: 'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top inset-x-0 top-0 border-b',
	bottom:
		'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom inset-x-0 bottom-0 border-t',
};

function SheetContent({
	className,
	children,
	side = 'right',
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	side?: 'left' | 'right' | 'top' | 'bottom';
}) {
	return (
		<SheetPortal>
			<SheetOverlay />
			<DialogPrimitive.Content
				data-slot="sheet-content"
				className={cn(
					'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg duration-300 outline-none',
					sheetSideVariants[side],
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close
					data-slot="sheet-close"
					className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
				>
					<XIcon />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div data-slot="sheet-header" className={cn('flex flex-col gap-2 p-4', className)} {...props} />
	);
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn('mt-auto flex flex-col gap-2 p-4', className)}
			{...props}
		/>
	);
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="sheet-title"
			className={cn('text-lg leading-none font-semibold', className)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="sheet-description"
			className={cn('text-muted-foreground text-sm', className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetOverlay,
	SheetPortal,
	SheetTitle,
	SheetTrigger,
};
