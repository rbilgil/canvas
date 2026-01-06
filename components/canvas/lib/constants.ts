/**
 * Canvas constants and default values
 */

// Default stroke and fill colors
export const COLORS = {
	stroke: "#0f172a",
	rectFill: "#94a3b833",
	ellipseFill: "#22c55e22",
	selection: "#2563eb",
	marquee: "#3b82f6",
	marqueeFill: "#60a5fa22",
	lasso: "#0ea5e9",
} as const;

// Default dimensions and sizes
export const SIZES = {
	strokeWidth: 4,
	selectionPadding: 4,
	handleSize: 8,
	handleStrokeWidth: 1.5,
	minShapeSize: 2,
	minPointDistance: 2,
} as const;

// Default shape properties
export const SHAPE_DEFAULTS = {
	text: {
		fontSize: 20,
		fontFamily: "ui-sans-serif, system-ui",
		fontWeight: "400",
	},
	path: {
		strokeWidth: SIZES.strokeWidth,
		stroke: COLORS.stroke,
	},
	rect: {
		fill: COLORS.rectFill,
		strokeWidth: 2,
	},
	ellipse: {
		fill: COLORS.ellipseFill,
		strokeWidth: 2,
	},
	line: {
		stroke: COLORS.stroke,
		strokeWidth: 2,
	},
} as const;
