import type React from "react";

export function ToolbarButton({
	title,
	active,
	onClick,
	children,
	disabled,
}: {
	title: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
	disabled?: boolean;
}) {
	return (
		<button
			title={title}
			onClick={onClick}
			type="button"
			disabled={disabled}
			className={`w-8 h-8 flex items-center justify-center rounded ${
				active
					? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
					: "bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800"
			} border border-slate-300 dark:border-slate-700 disabled:cursor-not-allowed`}
		>
			{children}
		</button>
	);
}
