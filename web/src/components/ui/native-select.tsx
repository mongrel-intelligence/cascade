import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * SSR-safe styled `<select>`. Matches the visual language of shadcn
 * `SelectTrigger` (border, height, focus ring, dark-mode) but renders a
 * native `<select>` element — so components using it work inside
 * `renderToStaticMarkup` without the radix-portal / React-instance
 * mismatch that `ui/select.tsx` would cause in unit tests.
 *
 * Used by the PM wizard's shared step components (`steps/*.tsx`) and
 * provider-specific steps where the form-control is the only visual
 * concern and a portal-based combobox would be overkill.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
	return (
		<select
			data-slot="native-select"
			className={cn(
				'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none',
				'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
				'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
				'dark:bg-input/30',
				className,
			)}
			{...props}
		>
			{children}
		</select>
	);
}

export { NativeSelect };
