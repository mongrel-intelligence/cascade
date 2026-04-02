import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import * as React from 'react';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';

export interface ComboboxOption {
	value: string;
	label: string;
	/** Optional secondary text shown next to the label (e.g. pricing) */
	detail?: string;
	/** Optional group for organizing options */
	group?: string;
}

interface ComboboxProps {
	value: string;
	onChange: (value: string) => void;
	options: ComboboxOption[];
	placeholder?: string;
	/** Text shown in the trigger button when no option is selected */
	emptyLabel?: string;
	/** Allow the user to type an arbitrary value not in the option list */
	allowCustom?: boolean;
	disabled?: boolean;
	id?: string;
	className?: string;
}

export function Combobox({
	value,
	onChange,
	options,
	placeholder = 'Search...',
	emptyLabel = 'Optional',
	allowCustom = false,
	disabled = false,
	id,
	className,
}: ComboboxProps) {
	const [open, setOpen] = React.useState(false);
	const [inputValue, setInputValue] = React.useState('');

	// Find the selected option's label for display
	const selectedOption = options.find((o) => o.value === value);
	const displayValue = selectedOption?.label ?? value;

	// Group options
	const groups = React.useMemo(() => {
		const map = new Map<string, ComboboxOption[]>();
		for (const option of options) {
			const group = option.group ?? '';
			const existing = map.get(group);
			if (existing) {
				existing.push(option);
			} else {
				map.set(group, [option]);
			}
		}
		return map;
	}, [options]);

	function handleSelect(optionValue: string) {
		onChange(optionValue);
		setInputValue('');
		setOpen(false);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' && allowCustom && inputValue && !open) {
			onChange(inputValue);
			setInputValue('');
		}
	}

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<Button
					id={id}
					variant="outline"
					aria-haspopup="listbox"
					aria-expanded={open}
					disabled={disabled}
					className={cn('w-full justify-between font-normal', className)}
				>
					<span className="truncate text-left">
						{displayValue || <span className="text-muted-foreground">{emptyLabel}</span>}
					</span>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					className="z-50 min-w-[var(--radix-popover-trigger-width)] w-max max-w-[600px] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
					sideOffset={4}
					align="start"
				>
					<CommandPrimitive className="flex flex-col" shouldFilter={true}>
						<div className="flex items-center border-b px-3">
							<CommandPrimitive.Input
								placeholder={placeholder}
								value={inputValue}
								onValueChange={setInputValue}
								onKeyDown={handleKeyDown}
								className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
							/>
						</div>
						<CommandPrimitive.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
							<CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
								{allowCustom && inputValue ? (
									<button
										type="button"
										className="cursor-pointer underline"
										onClick={() => handleSelect(inputValue)}
									>
										Use &quot;{inputValue}&quot;
									</button>
								) : (
									'No results found.'
								)}
							</CommandPrimitive.Empty>

							{[...groups.entries()].map(([groupName, groupOptions]) => (
								<CommandPrimitive.Group key={groupName} heading={groupName || undefined}>
									{groupOptions.map((option) => (
										<CommandPrimitive.Item
											key={option.value}
											value={option.value}
											onSelect={() => handleSelect(option.value)}
											className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
										>
											<Check
												className={cn(
													'mr-2 h-4 w-4 shrink-0',
													value === option.value ? 'opacity-100' : 'opacity-0',
												)}
											/>
											<span className="flex-1 truncate">{option.label}</span>
											{option.detail && (
												<span className="ml-2 shrink-0 text-xs text-muted-foreground">
													{option.detail}
												</span>
											)}
										</CommandPrimitive.Item>
									))}
								</CommandPrimitive.Group>
							))}

							{allowCustom && inputValue && options.every((o) => o.value !== inputValue) && (
								<CommandPrimitive.Group>
									<CommandPrimitive.Item
										value={`__custom__${inputValue}`}
										onSelect={() => handleSelect(inputValue)}
										className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
									>
										<Check className="mr-2 h-4 w-4 shrink-0 opacity-0" />
										<span className="flex-1 truncate text-muted-foreground">
											Use &quot;{inputValue}&quot;
										</span>
									</CommandPrimitive.Item>
								</CommandPrimitive.Group>
							)}
						</CommandPrimitive.List>
					</CommandPrimitive>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
