/**
 * Pure functions for converting AI commands into shape updates and new shapes.
 * These are decoupled from React state and can be easily tested.
 */

import type {
	CanvasShape,
	CanvasToolCommand,
	ImageShape,
	TextShape,
} from "../types";

// =============================================================================
// Types
// =============================================================================

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CreateShapeOptions {
	/** Function to generate unique shape IDs */
	createId: (prefix: string) => string;
}

export interface ImageGenerationResult {
	storageUrl: string;
	width: number;
	height: number;
}

// =============================================================================
// Edit Shape Command Handlers
// =============================================================================

interface EditShapeParams {
	x?: number;
	y?: number;
	dx?: number;
	dy?: number;
	width?: number;
	height?: number;
	scale?: number;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	radius?: number;
	x2?: number;
	y2?: number;
}

interface EditTextParams {
	text?: string;
	fontSize?: number;
	fontWeight?: string;
	fontFamily?: string;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	shadow?: {
		color: string;
		blur: number;
		offsetX: number;
		offsetY: number;
	};
	x?: number;
	y?: number;
	dx?: number;
	dy?: number;
}

/**
 * Compute updates for an editShape command.
 * Returns null if there are no updates to apply.
 */
export function computeEditShapeUpdates(
	shape: CanvasShape,
	cmd: EditShapeParams,
): Partial<CanvasShape> | null {
	const updates: Record<string, unknown> = {};

	// Movement (absolute or relative)
	if (cmd.x !== undefined) updates.x = cmd.x;
	if (cmd.y !== undefined) updates.y = cmd.y;
	if (cmd.dx !== undefined) {
		updates.x = ((updates.x as number | undefined) ?? shape.x) + cmd.dx;
	}
	if (cmd.dy !== undefined) {
		updates.y = ((updates.y as number | undefined) ?? shape.y) + cmd.dy;
	}

	// Line end points
	if (shape.type === "line") {
		if (cmd.x2 !== undefined) updates.x2 = cmd.x2;
		if (cmd.y2 !== undefined) updates.y2 = cmd.y2;
		if (cmd.dx !== undefined) {
			updates.x2 = shape.x2 + cmd.dx;
		}
		if (cmd.dy !== undefined) {
			updates.y2 = shape.y2 + cmd.dy;
		}
	}

	// Sizing
	if ("width" in shape && "height" in shape) {
		if (cmd.scale !== undefined) {
			updates.width = shape.width * cmd.scale;
			updates.height = shape.height * cmd.scale;
		} else {
			if (cmd.width !== undefined) updates.width = cmd.width;
			if (cmd.height !== undefined) updates.height = cmd.height;
		}
	}

	// Styling
	if (cmd.fill !== undefined) updates.fill = cmd.fill;
	if (cmd.stroke !== undefined) updates.stroke = cmd.stroke;
	if (cmd.strokeWidth !== undefined) updates.strokeWidth = cmd.strokeWidth;
	if (cmd.radius !== undefined && "radius" in shape) {
		updates.radius = cmd.radius;
	}

	return Object.keys(updates).length > 0
		? (updates as Partial<CanvasShape>)
		: null;
}

/**
 * Compute updates for an editText command.
 * Returns null if there are no updates to apply.
 */
export function computeEditTextUpdates(
	shape: TextShape,
	cmd: EditTextParams,
): Partial<TextShape> | null {
	const updates: Partial<TextShape> = {};

	// Text-specific properties
	if (cmd.text !== undefined) updates.text = cmd.text;
	if (cmd.fontSize !== undefined) updates.fontSize = cmd.fontSize;
	if (cmd.fontWeight !== undefined) updates.fontWeight = cmd.fontWeight;
	if (cmd.fontFamily !== undefined) updates.fontFamily = cmd.fontFamily;
	if (cmd.shadow !== undefined) updates.shadow = cmd.shadow;

	// Styling (inherited from base)
	if (cmd.fill !== undefined) updates.fill = cmd.fill;
	if (cmd.stroke !== undefined) updates.stroke = cmd.stroke;
	if (cmd.strokeWidth !== undefined) updates.strokeWidth = cmd.strokeWidth;

	// Position (absolute or relative)
	if (cmd.x !== undefined) updates.x = cmd.x;
	if (cmd.y !== undefined) updates.y = cmd.y;
	if (cmd.dx !== undefined) {
		updates.x = ((updates.x as number | undefined) ?? shape.x) + cmd.dx;
	}
	if (cmd.dy !== undefined) {
		updates.y = ((updates.y as number | undefined) ?? shape.y) + cmd.dy;
	}

	return Object.keys(updates).length > 0 ? updates : null;
}

// =============================================================================
// Shape Creation from Commands
// =============================================================================

/**
 * Create a new shape from a creation command.
 * Returns the shape to add, or null if the command is not a creation command.
 */
export function shapeFromCommand(
	cmd: CanvasToolCommand,
	options: CreateShapeOptions,
): CanvasShape | null {
	const { createId } = options;

	switch (cmd.tool) {
		case "generateSvg":
			if (!cmd.svg) return null;
			return {
				id: cmd.id || createId("svg"),
				type: "svg",
				x: cmd.x ?? 40,
				y: cmd.y ?? 40,
				width: cmd.width ?? 100,
				height: cmd.height ?? 100,
				svg: cmd.svg,
			};

		case "createRect":
			return {
				id: createId("rect"),
				type: "rect",
				x: cmd.x ?? 100,
				y: cmd.y ?? 100,
				width: cmd.width ?? 100,
				height: cmd.height ?? 100,
				fill: cmd.fill ?? "transparent",
				stroke: cmd.stroke ?? "#0f172a",
				strokeWidth: cmd.strokeWidth ?? 2,
				radius: cmd.radius,
			};

		case "createEllipse":
			return {
				id: createId("ellipse"),
				type: "ellipse",
				x: cmd.x ?? 100,
				y: cmd.y ?? 100,
				width: cmd.width ?? 100,
				height: cmd.height ?? 100,
				fill: cmd.fill ?? "transparent",
				stroke: cmd.stroke ?? "#0f172a",
				strokeWidth: cmd.strokeWidth ?? 2,
			};

		case "createLine":
			return {
				id: createId("line"),
				type: "line",
				x: cmd.x1 ?? 100,
				y: cmd.y1 ?? 100,
				x2: cmd.x2 ?? 200,
				y2: cmd.y2 ?? 200,
				stroke: cmd.stroke ?? "#0f172a",
				strokeWidth: cmd.strokeWidth ?? 2,
			};

		case "createText":
			return {
				id: createId("text"),
				type: "text",
				x: cmd.x ?? 100,
				y: cmd.y ?? 100,
				text: cmd.text ?? "Text",
				fontSize: cmd.fontSize ?? 20,
				fontWeight: cmd.fontWeight ?? "400",
				fontFamily: cmd.fontFamily ?? "ui-sans-serif, system-ui",
				fill: cmd.fill ?? "#0f172a",
				stroke: cmd.stroke,
				strokeWidth: cmd.strokeWidth,
				shadow: cmd.shadow,
			};

		default:
			return null;
	}
}

// =============================================================================
// Z-Order Operations
// =============================================================================

export type ZOrderCommand =
	| "bringToFront"
	| "sendToBack"
	| "moveUp"
	| "moveDown";

/**
 * Apply a z-order command to an array of shapes.
 * Returns a new array with the target shape reordered, or null if no change.
 */
export function applyZOrder(
	shapes: CanvasShape[],
	targetId: string,
	command: ZOrderCommand,
): CanvasShape[] | null {
	const idx = shapes.findIndex((s) => s.id === targetId);
	if (idx === -1) return null;

	const newShapes = [...shapes];
	const [shape] = newShapes.splice(idx, 1);

	switch (command) {
		case "bringToFront":
			newShapes.push(shape);
			break;

		case "sendToBack":
			newShapes.unshift(shape);
			break;

		case "moveUp":
			if (idx >= shapes.length - 1) return null; // Already at top
			newShapes.splice(idx + 1, 0, shape);
			break;

		case "moveDown":
			if (idx <= 0) return null; // Already at bottom
			newShapes.splice(idx - 1, 0, shape);
			break;
	}

	return newShapes;
}

/**
 * Check if a command is a z-order command
 */
export function isZOrderCommand(
	cmd: CanvasToolCommand,
): cmd is CanvasToolCommand & { tool: ZOrderCommand } {
	return (
		cmd.tool === "bringToFront" ||
		cmd.tool === "sendToBack" ||
		cmd.tool === "moveUp" ||
		cmd.tool === "moveDown"
	);
}

/**
 * Check if a command is a shape creation command
 */
export function isCreateCommand(cmd: CanvasToolCommand): boolean {
	return (
		cmd.tool === "createRect" ||
		cmd.tool === "createEllipse" ||
		cmd.tool === "createLine" ||
		cmd.tool === "createText" ||
		cmd.tool === "generateSvg"
	);
}

/**
 * Check if a command is an async/image command that requires API calls
 */
export function isAsyncCommand(cmd: CanvasToolCommand): boolean {
	return (
		cmd.tool === "generateImage" ||
		cmd.tool === "editImage" ||
		cmd.tool === "combineSelection"
	);
}

// =============================================================================
// Async Command Helpers
// =============================================================================

/**
 * Calculate the bounding box of a set of shapes.
 * Returns the smallest rectangle that contains all the shapes.
 */
export function calculateShapesBounds(shapes: CanvasShape[]): Bounds {
	if (shapes.length === 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const xs = shapes.map((s) => s.x);
	const ys = shapes.map((s) => s.y);
	const x2s = shapes.map((s) => ("width" in s ? s.x + s.width : s.x));
	const y2s = shapes.map((s) => ("height" in s ? s.y + s.height : s.y));

	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...x2s);
	const maxY = Math.max(...y2s);

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/**
 * Resolve which shape IDs should be used for a selection-based operation.
 * Returns undefined if the full canvas should be used.
 */
export function resolveSelectionIds(
	selectedIds: string[],
	selectedId: string | null,
): string[] | undefined {
	if (selectedIds.length > 0) return selectedIds;
	if (selectedId) return [selectedId];
	return undefined; // Full canvas
}

/**
 * Get the shapes that match the given IDs, or all shapes if ids is undefined.
 */
export function getShapesForIds(
	allShapes: CanvasShape[],
	ids: string[] | undefined,
): CanvasShape[] {
	if (!ids) return allShapes;
	return allShapes.filter((s) => ids.includes(s.id));
}

/**
 * Build the prompt for the combineSelection command.
 * This creates a detailed instruction for the AI to merge selected elements.
 */
export function buildCombineSelectionPrompt(userPrompt: string): string {
	return `Based on the reference image, create a new cohesive image that:
- Preserves the general placement and positioning of elements from the reference
- Maintains the overall composition and spatial arrangement
- Transforms the separate elements into a unified, cohesive scene (not disjoint cutouts)
- Follows this user instruction: ${userPrompt}

Generate a polished, complete image that feels like a single unified artwork, not a collage.`;
}

/**
 * Create an ImageShape from a generation result.
 */
export function createImageShapeFromResult(
	result: ImageGenerationResult,
	options: {
		id: string;
		x: number;
		y: number;
	},
): ImageShape {
	return {
		id: options.id,
		type: "image",
		x: options.x,
		y: options.y,
		width: result.width,
		height: result.height,
		href: result.storageUrl,
	};
}

/**
 * Prepare context for a generateImage command.
 * Returns the position and reference image URL if applicable.
 */
export function prepareGenerateImageContext(
	cmd: CanvasToolCommand & { tool: "generateImage" },
	hasSelection: boolean,
	canvasDataUrl?: string,
): {
	x: number;
	y: number;
	referenceImageUrl: string | undefined;
} {
	return {
		x: cmd.x ?? 40,
		y: cmd.y ?? 40,
		referenceImageUrl: hasSelection ? canvasDataUrl : undefined,
	};
}
