import * as React from "react";
import { cn } from "@/lib/utils";

export interface ComboboxOption<T extends string = string> {
	value: T;
	label: string;
}

export interface ComboboxProps<T extends string = string>
	extends React.SelectHTMLAttributes<HTMLSelectElement> {
	options: Array<ComboboxOption<T>>;
}

export const Combobox = React.forwardRef<HTMLSelectElement, ComboboxProps>(
	({ className, options, ...props }, ref) => {
		return (
			<select
				ref={ref}
				className={cn(
					"h-9 rounded-md border border-input bg-background px-2 text-sm",
					"outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
					className,
				)}
				{...props}
			>
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		);
	},
);
Combobox.displayName = "Combobox";
