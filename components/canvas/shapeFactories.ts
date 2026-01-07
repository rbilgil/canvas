import type {
	CanvasShape,
	EllipseShape,
	ImageShape,
	LineShape,
	RectShape,
	SvgShape,
	TextShape,
} from "./types";
import { createShapeId } from "./utils";

export function createRect(args: {
	id?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	stroke?: string;
	strokeWidth?: number;
	fill?: string;
	opacity?: number;
	radius?: number;
}): RectShape {
	return {
		id: args.id ?? createShapeId("rect"),
		type: "rect",
		x: args.x,
		y: args.y,
		width: Math.max(1, args.width ?? 1),
		height: Math.max(1, args.height ?? 1),
		stroke: args.stroke ?? "#0f172a",
		strokeWidth: args.strokeWidth ?? 2,
		fill: args.fill ?? "transparent",
		opacity: args.opacity,
		radius: args.radius,
	};
}

export function createEllipse(args: {
	id?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	stroke?: string;
	strokeWidth?: number;
	fill?: string;
	opacity?: number;
}): EllipseShape {
	return {
		id: args.id ?? createShapeId("ellipse"),
		type: "ellipse",
		x: args.x,
		y: args.y,
		width: Math.max(1, args.width ?? 1),
		height: Math.max(1, args.height ?? 1),
		stroke: args.stroke ?? "#0f172a",
		strokeWidth: args.strokeWidth ?? 2,
		fill: args.fill ?? "transparent",
		opacity: args.opacity,
	};
}

export function createLine(args: {
	id?: string;
	x: number;
	y: number;
	x2?: number;
	y2?: number;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}): LineShape {
	return {
		id: args.id ?? createShapeId("line"),
		type: "line",
		x: args.x,
		y: args.y,
		x2: args.x2 ?? args.x,
		y2: args.y2 ?? args.y,
		stroke: args.stroke ?? "#0f172a",
		strokeWidth: args.strokeWidth ?? 2,
		opacity: args.opacity,
	};
}

export function createText(args: {
	id?: string;
	x: number;
	y: number;
	text?: string;
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: string;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	shadow?: {
		color: string;
		blur: number;
		offsetX: number;
		offsetY: number;
	};
	opacity?: number;
}): TextShape {
	return {
		id: args.id ?? createShapeId("text"),
		type: "text",
		x: args.x,
		y: args.y,
		text: args.text ?? "",
		fontSize: args.fontSize ?? 20,
		fontFamily: args.fontFamily,
		fontWeight: args.fontWeight,
		fill: args.fill ?? "#0f172a",
		stroke: args.stroke,
		strokeWidth: args.strokeWidth,
		shadow: args.shadow,
		opacity: args.opacity,
	};
}

export function createImage(args: {
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	href: string;
	opacity?: number;
}): ImageShape {
	return {
		id: args.id ?? createShapeId("img"),
		type: "image",
		x: args.x,
		y: args.y,
		width: Math.max(1, args.width),
		height: Math.max(1, args.height),
		href: args.href,
		opacity: args.opacity,
	};
}

export function createSvg(args: {
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	svg: string;
	opacity?: number;
}): SvgShape {
	return {
		id: args.id ?? createShapeId("svg"),
		type: "svg",
		x: args.x,
		y: args.y,
		width: Math.max(1, args.width),
		height: Math.max(1, args.height),
		svg: args.svg,
		opacity: args.opacity,
	};
}

export type AnyCreatedShape = CanvasShape;
