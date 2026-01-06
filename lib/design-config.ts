import { z } from "zod";

// =============================================================================
// Shape Schemas - Single source of truth for shape definitions
// Types are derived from these schemas using z.infer<>
// =============================================================================

export const BaseShapeSchema = z.object({
	id: z.string(),
	x: z.number(),
	y: z.number(),
	rotationDeg: z.number().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	fill: z.string().optional(),
	opacity: z.number().optional(),
});

export const RectShapeSchema = BaseShapeSchema.extend({
	type: z.literal("rect"),
	width: z.number(),
	height: z.number(),
	radius: z.number().optional(),
});

export const EllipseShapeSchema = BaseShapeSchema.extend({
	type: z.literal("ellipse"),
	width: z.number(),
	height: z.number(),
});

export const LineShapeSchema = BaseShapeSchema.extend({
	type: z.literal("line"),
	x2: z.number(),
	y2: z.number(),
});

export const TextShapeSchema = BaseShapeSchema.extend({
	type: z.literal("text"),
	text: z.string(),
	fontSize: z.number(),
	fontFamily: z.string().optional(),
	fontWeight: z.string().optional(),
});

export const SvgShapeSchema = BaseShapeSchema.extend({
	type: z.literal("svg"),
	width: z.number(),
	height: z.number(),
	svg: z.string(),
});

export const ImageShapeSchema = BaseShapeSchema.extend({
	type: z.literal("image"),
	width: z.number(),
	height: z.number(),
	href: z.string(),
});

export const PathPointSchema = z.object({
	x: z.number(),
	y: z.number(),
	moveTo: z.boolean().optional(),
});

export const PathShapeSchema = BaseShapeSchema.extend({
	type: z.literal("path"),
	points: z.array(PathPointSchema),
});

export const CanvasShapeSchema = z.discriminatedUnion("type", [
	RectShapeSchema,
	EllipseShapeSchema,
	LineShapeSchema,
	TextShapeSchema,
	SvgShapeSchema,
	ImageShapeSchema,
	PathShapeSchema,
]);

export const DesignConfigSchema = z.object({
	shapes: z.array(CanvasShapeSchema).default([]),
});

export type DesignConfig = z.infer<typeof DesignConfigSchema>;

// Parse and validate a design config, returning a default if invalid
export function parseDesignConfig(config: unknown): DesignConfig {
	const result = DesignConfigSchema.safeParse(config);
	if (result.success) {
		return result.data;
	}
	console.warn("Invalid design config, using default:", result.error);
	return { shapes: [] };
}
