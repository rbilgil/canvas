import { z } from "zod";
import {
	BaseShapeSchema,
	RectShapeSchema,
	EllipseShapeSchema,
	LineShapeSchema,
	TextShapeSchema,
	SvgShapeSchema,
	ImageShapeSchema,
	PathShapeSchema,
	PathPointSchema,
	CanvasShapeSchema,
} from "@/lib/design-config";

// =============================================================================
// Shape Types - Derived from Zod schemas in lib/design-config.ts
// This ensures frontend and backend schemas are always in sync
// =============================================================================

export type ShapeType = CanvasShape["type"];

export type BaseShape = z.infer<typeof BaseShapeSchema> & { type: ShapeType };
export type RectShape = z.infer<typeof RectShapeSchema>;
export type EllipseShape = z.infer<typeof EllipseShapeSchema>;
export type LineShape = z.infer<typeof LineShapeSchema>;
export type TextShape = z.infer<typeof TextShapeSchema>;
export type SvgShape = z.infer<typeof SvgShapeSchema>;
export type ImageShape = z.infer<typeof ImageShapeSchema>;
export type PathPoint = z.infer<typeof PathPointSchema>;
export type PathShape = z.infer<typeof PathShapeSchema>;

export type CanvasShape = z.infer<typeof CanvasShapeSchema>;

// =============================================================================
// Command Types
// =============================================================================

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

// =============================================================================
// UI Types
// =============================================================================

export type Tool =
	| "select"
	| "draw-rect"
	| "draw-ellipse"
	| "draw-line"
	| "draw-text"
	| "draw-pencil"
	| "lasso";

export type PointerMode =
	| "move"
	| { resize: "nw" | "ne" | "sw" | "se" }
	| { lineEnd: 1 | 2 };
