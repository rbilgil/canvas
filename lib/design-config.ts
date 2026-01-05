import { z } from "zod";

// Shape schemas matching the canvas types
const BaseShapeSchema = z.object({
	id: z.string(),
	x: z.number(),
	y: z.number(),
	rotationDeg: z.number().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	fill: z.string().optional(),
	opacity: z.number().optional(),
});

const RectShapeSchema = BaseShapeSchema.extend({
	type: z.literal("rect"),
	width: z.number(),
	height: z.number(),
	radius: z.number().optional(),
});

const EllipseShapeSchema = BaseShapeSchema.extend({
	type: z.literal("ellipse"),
	width: z.number(),
	height: z.number(),
});

const LineShapeSchema = BaseShapeSchema.extend({
	type: z.literal("line"),
	x2: z.number(),
	y2: z.number(),
});

const TextShapeSchema = BaseShapeSchema.extend({
	type: z.literal("text"),
	text: z.string(),
	fontSize: z.number(),
	fontFamily: z.string().optional(),
	fontWeight: z.string().optional(),
});

const SvgShapeSchema = BaseShapeSchema.extend({
	type: z.literal("svg"),
	width: z.number(),
	height: z.number(),
	svg: z.string(),
});

const ImageShapeSchema = BaseShapeSchema.extend({
	type: z.literal("image"),
	width: z.number(),
	height: z.number(),
	href: z.string(),
});

export const CanvasShapeSchema = z.discriminatedUnion("type", [
	RectShapeSchema,
	EllipseShapeSchema,
	LineShapeSchema,
	TextShapeSchema,
	SvgShapeSchema,
	ImageShapeSchema,
]);

export const DesignConfigSchema = z.object({
	shapes: z.array(CanvasShapeSchema).default([]),
});

export type DesignConfig = z.infer<typeof DesignConfigSchema>;
export type CanvasShapeFromSchema = z.infer<typeof CanvasShapeSchema>;

// Parse and validate a design config, returning a default if invalid
export function parseDesignConfig(config: unknown): DesignConfig {
	const result = DesignConfigSchema.safeParse(config);
	if (result.success) {
		return result.data;
	}
	console.warn("Invalid design config, using default:", result.error);
	return { shapes: [] };
}
