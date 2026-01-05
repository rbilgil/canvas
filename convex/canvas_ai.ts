"use node";

import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, streamObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { action } from "./_generated/server";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

function selectModel() {
	const modelName = process.env.AI_MODEL || "gpt-5";
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("Missing OPENAI_API_KEY");
	}
	return openai(modelName);
}

// Zod schema for tool commands
const MoveCommand = z.object({
	tool: z.literal("moveObject"),
	id: z.string().optional(),
	target: z.string().optional(),
	dx: z.number(),
	dy: z.number(),
});

const ResizeCommand = z.object({
	tool: z.literal("resize"),
	id: z.string().optional(),
	target: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	scale: z.number().optional(),
});

const hexColor = z
	.string()
	.regex(
		/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/,
		"HEX color like #RRGGBB or #RGB",
	);

const ChangeColorCommand = z.object({
	tool: z.literal("changeColor"),
	id: z.string().optional(),
	target: z.string().optional(),
	fill: hexColor.optional(),
	stroke: hexColor.optional(),
});

const GenerateSvgCommand = z.object({
	tool: z.literal("generateSvg"),
	id: z.string().optional(),
	svg: z.string(),
	x: z.number().optional(),
	y: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

const GenerateImageCommand = z.object({
	tool: z.literal("generateImage"),
	id: z.string().optional(),
	prompt: z.string(),
	x: z.number().optional(),
	y: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

const EditImageCommand = z.object({
	tool: z.literal("editImage"),
	id: z.string().optional(),
	prompt: z.string(),
});

const CombineSelectionCommand = z.object({
	tool: z.literal("combineSelection"),
});

const CommandSchema = z.union([
	MoveCommand,
	ResizeCommand,
	ChangeColorCommand,
	GenerateSvgCommand,
	GenerateImageCommand,
	EditImageCommand,
	CombineSelectionCommand,
]);

export type CanvasCommand = z.infer<typeof CommandSchema>;

export const interpret = action({
	args: { input: v.string() },
	returns: v.object({
		commands: v.array(
			v.union(
				v.object({
					tool: v.literal("moveObject"),
					id: v.optional(v.string()),
					target: v.optional(v.string()),
					dx: v.number(),
					dy: v.number(),
				}),
				v.object({
					tool: v.literal("resize"),
					id: v.optional(v.string()),
					target: v.optional(v.string()),
					width: v.optional(v.number()),
					height: v.optional(v.number()),
					scale: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("changeColor"),
					id: v.optional(v.string()),
					target: v.optional(v.string()),
					fill: v.optional(v.string()),
					stroke: v.optional(v.string()),
				}),
				v.object({
					tool: v.literal("generateSvg"),
					id: v.optional(v.string()),
					svg: v.string(),
					x: v.optional(v.number()),
					y: v.optional(v.number()),
					width: v.optional(v.number()),
					height: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("generateImage"),
					id: v.optional(v.string()),
					prompt: v.string(),
					x: v.optional(v.number()),
					y: v.optional(v.number()),
					width: v.optional(v.number()),
					height: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("editImage"),
					id: v.optional(v.string()),
					prompt: v.string(),
				}),
				v.object({
					tool: v.literal("combineSelection"),
				}),
			),
		),
	}),
	handler: async (_ctx, args) => {
		const model = selectModel();

		const system = [
			"You are a UI copilot for a vector canvas app.",
			'Return ONLY JSON of the form {"commands": [...]}. No prose, no code fences.',
			"If the user's intent is ambiguous, make a sensible default.",
			"If a specific shape id is not provided, omit 'id' and 'target'. The client will apply to the selected shape.",
			"For resize: prefer scale if user says 'bigger/smaller'; otherwise set width/height explicitly if mentioned.",
			"For move: dx/dy are pixels; positive dx moves right, positive dy moves down.",
			"For changeColor: support either fill, stroke, or both. Colors MUST be HEX codes only (#RRGGBB or #RGB). Never return names or rgba/hsl. If unsure, omit the property.",
			"You can also generate SVG art: use the generateSvg tool with fields {id, svg, x?, y?, width?, height?}. Return a valid, self-contained <svg>...</svg> string in svg.",
			'To merge currently selected shapes into one raster image, return a single command: {"tool": "combineSelection"}.',
		].join("\n");

		// Stream object so we can log partial output as it arrives
		const { object } = await generateObject({
			model,
			system,
			messages: [
				{ role: "user", content: [{ type: "text", text: args.input }] },
			],
			schema: z.object({ commands: z.array(CommandSchema).default([]) }),
			temperature: 0.1,
			maxRetries: 3,
			providerOptions: {
				openai: {
					reasoningEffort: "minimal",
				},
			},
		});

		console.log("canvas_ai.final", object);
		const commands: Array<CanvasCommand> = Array.isArray(object?.commands)
			? (object.commands as Array<CanvasCommand>)
			: [];
		return { commands };
	},
});
