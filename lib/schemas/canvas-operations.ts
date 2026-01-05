/**
 * Shared Zod Schemas for Canvas Operations
 *
 * These schemas are used by both frontend and backend to ensure
 * consistent validation of CRDT operations across the stack.
 */

import { z } from "zod";

// ============================================================================
// Shape Schemas
// ============================================================================

const baseShapeSchema = z.object({
	id: z.string(),
	x: z.number(),
	y: z.number(),
	rotationDeg: z.number().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	fill: z.string().optional(),
	opacity: z.number().optional(),
});

export const rectShapeSchema = baseShapeSchema.extend({
	type: z.literal("rect"),
	width: z.number(),
	height: z.number(),
	radius: z.number().optional(),
});

export const ellipseShapeSchema = baseShapeSchema.extend({
	type: z.literal("ellipse"),
	width: z.number(),
	height: z.number(),
});

export const lineShapeSchema = baseShapeSchema.extend({
	type: z.literal("line"),
	x2: z.number(),
	y2: z.number(),
});

export const textShapeSchema = baseShapeSchema.extend({
	type: z.literal("text"),
	text: z.string(),
	fontSize: z.number(),
	fontFamily: z.string().optional(),
	fontWeight: z.string().optional(),
});

export const svgShapeSchema = baseShapeSchema.extend({
	type: z.literal("svg"),
	width: z.number(),
	height: z.number(),
	svg: z.string(),
});

export const imageShapeSchema = baseShapeSchema.extend({
	type: z.literal("image"),
	width: z.number(),
	height: z.number(),
	href: z.string(),
});

export const canvasShapeSchema = z.discriminatedUnion("type", [
	rectShapeSchema,
	ellipseShapeSchema,
	lineShapeSchema,
	textShapeSchema,
	svgShapeSchema,
	imageShapeSchema,
]);

export type CanvasShapeSchema = z.infer<typeof canvasShapeSchema>;

// ============================================================================
// Operation Schemas
// ============================================================================

// Partial shape schema for updates (all fields optional)
const partialShapeSchema = z.record(z.string(), z.unknown());

const baseOperationSchema = z.object({
	id: z.string(),
	timestamp: z.number(),
	clientId: z.string(),
});

export const addShapeOperationSchema = baseOperationSchema.extend({
	type: z.literal("addShape"),
	shape: canvasShapeSchema,
});

export const updateShapeOperationSchema = baseOperationSchema.extend({
	type: z.literal("updateShape"),
	shapeId: z.string(),
	updates: partialShapeSchema,
	previousValues: partialShapeSchema,
});

export const deleteShapeOperationSchema = baseOperationSchema.extend({
	type: z.literal("deleteShape"),
	shapeId: z.string(),
	deletedShape: canvasShapeSchema,
});

export const canvasOperationSchema = z.discriminatedUnion("type", [
	addShapeOperationSchema,
	updateShapeOperationSchema,
	deleteShapeOperationSchema,
]);

export type CanvasOperationSchema = z.infer<typeof canvasOperationSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse an operation from unknown data.
 * Throws ZodError if validation fails.
 */
export function parseOperation(data: unknown): CanvasOperationSchema {
	return canvasOperationSchema.parse(data);
}

/**
 * Safely validate an operation, returning null if invalid.
 * Use this when you want to gracefully handle corrupted data.
 */
export function safeParseOperation(
	data: unknown,
): CanvasOperationSchema | null {
	const result = canvasOperationSchema.safeParse(data);
	if (result.success) {
		return result.data;
	}
	console.warn("Invalid operation data:", result.error.format());
	return null;
}

/**
 * Validate a shape from unknown data.
 * Throws ZodError if validation fails.
 */
export function parseShape(data: unknown): CanvasShapeSchema {
	return canvasShapeSchema.parse(data);
}

/**
 * Safely validate a shape, returning null if invalid.
 */
export function safeParseShape(data: unknown): CanvasShapeSchema | null {
	const result = canvasShapeSchema.safeParse(data);
	if (result.success) {
		return result.data;
	}
	console.warn("Invalid shape data:", result.error.format());
	return null;
}
