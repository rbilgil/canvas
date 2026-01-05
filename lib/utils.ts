import { type ClassValue, clsx } from "clsx";
import { formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Formats a timestamp (ms) into a relative string like "2 minutes ago"
// Uses Intl.RelativeTimeFormat which is widely supported and lightweight
export function formatRelativeTime(timestampMs: number): string {
	return formatDistanceToNow(new Date(timestampMs), { addSuffix: true });
}
