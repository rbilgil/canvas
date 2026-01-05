export type ShapeType = "rect" | "ellipse" | "line" | "text" | "svg" | "image";

export type BaseShape = {
	id: string;
	type: ShapeType;
	x: number;
	y: number;
	rotationDeg?: number;
	stroke?: string;
	strokeWidth?: number;
	fill?: string;
	opacity?: number;
};

export type RectShape = BaseShape & {
	type: "rect";
	width: number;
	height: number;
	radius?: number;
};

export type EllipseShape = BaseShape & {
	type: "ellipse";
	width: number;
	height: number;
};

export type LineShape = BaseShape & {
	type: "line";
	x2: number;
	y2: number;
};

export type TextShape = BaseShape & {
	type: "text";
	text: string;
	fontSize: number;
	fontFamily?: string;
	fontWeight?: string;
};

export type SvgShape = BaseShape & {
	type: "svg";
	width: number;
	height: number;
	svg: string;
};

export type ImageShape = BaseShape & {
	type: "image";
	width: number;
	height: number;
	href: string;
};

export type CanvasShape =
	| RectShape
	| EllipseShape
	| LineShape
	| TextShape
	| SvgShape
	| ImageShape;

export type CanvasToolCommand = {
	tool:
		| "moveObject"
		| "resize"
		| "changeColor"
		| "generateSvg"
		| "generateImage"
		| "editImage"
		| "combineSelection";
	id?: string;
	target?: string;
	dx?: number;
	dy?: number;
	width?: number;
	height?: number;
	scale?: number;
	fill?: string;
	stroke?: string;
	svg?: string;
	x?: number;
	y?: number;
	prompt?: string;
	dataUrl?: string;
};

export type LocalUndoCommand =
	| { tool: "replaceShape"; shape: CanvasShape }
	| { tool: "deleteObject"; id: string };

export type AnyCommand = CanvasToolCommand | LocalUndoCommand;

export type Tool =
	| "select"
	| "draw-rect"
	| "draw-ellipse"
	| "draw-line"
	| "draw-text"
	| "lasso";

export type PointerMode =
	| "move"
	| { resize: "nw" | "ne" | "sw" | "se" }
	| { lineEnd: 1 | 2 };
