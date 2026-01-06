"use node";

import { type GoogleGenerativeAIProviderOptions, google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { action } from "./_generated/server";

function selectModel() {
	const modelName = process.env.AI_MODEL || "gemini-3-flash";
	if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
		throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");
	}
	return google(modelName);
}

// Zod schema for tool commands
const MoveCommand = z
	.object({
		tool: z.literal("moveObject"),
		id: z.string().optional(),
		target: z.string().optional(),
		dx: z.number(),
		dy: z.number(),
	})
	.strict();

const ResizeCommand = z
	.object({
		tool: z.literal("resize"),
		id: z.string().optional(),
		target: z.string().optional(),
		width: z.number().optional(),
		height: z.number().optional(),
		scale: z.number().optional(),
	})
	.strict();

const hexColor = z
	.string()
	.regex(
		/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/,
		"HEX color like #RRGGBB or #RGB",
	);

const ChangeColorCommand = z
	.object({
		tool: z.literal("changeColor"),
		id: z.string().optional(),
		target: z.string().optional(),
		fill: hexColor.optional(),
		stroke: hexColor.optional(),
	})
	.strict();

const GenerateSvgCommand = z
	.object({
		tool: z.literal("generateSvg"),
		id: z.string().optional(),
		svg: z.string(),
		x: z.number().optional(),
		y: z.number().optional(),
		width: z.number().optional(),
		height: z.number().optional(),
	})
	.strict();

const GenerateImageCommand = z
	.object({
		tool: z.literal("generateImage"),
		id: z.string().optional(),
		prompt: z.string(),
		x: z.number().optional(),
		y: z.number().optional(),
		width: z.number().optional(),
		height: z.number().optional(),
	})
	.strict();

const EditImageCommand = z
	.object({
		tool: z.literal("editImage"),
		id: z.string().optional(),
		prompt: z.string(),
	})
	.strict();

const CombineSelectionCommand = z
	.object({
		tool: z.literal("combineSelection"),
	})
	.strict();

const CommandSchema = z.discriminatedUnion("tool", [
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
	args: {
		input: v.string(),
		// Optional visual context as base64 data URL
		imageContext: v.optional(v.string()),
		// Description of what the image shows (e.g., "selected rect shape", "full canvas")
		contextDescription: v.optional(v.string()),
	},
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
		// Validate model is configured (throws if not)
		selectModel();

		const systemParts = [
			"You are a UI copilot for a vector canvas app.",
			'Return ONLY JSON of the form {"commands": [...]}. No prose, no code fences.',
			"If the user's intent is ambiguous, make a sensible default.",
			"If a specific shape id is not provided, omit 'id' and 'target'. The client will apply to the selected shape.",
			"For resize: prefer scale if user says 'bigger/smaller'; otherwise set width/height explicitly if mentioned.",
			"For move: dx/dy are pixels; positive dx moves right, positive dy moves down.",
			"For changeColor: support either fill, stroke, or both. Colors MUST be HEX codes only (#RRGGBB or #RGB). Never return names or rgba/hsl. If unsure, omit the property.",
			"You can also generate SVG art: use the generateSvg tool with fields {id, svg, x?, y?, height?}. Return a valid, self-contained <svg>...</svg> string in svg.",
			'To merge currently selected shapes into one raster image, return a single command: {"tool": "combineSelection"}.',
		];

		// Add context description if provided
		if (args.contextDescription) {
			systemParts.push(
				`\nYou are looking at: ${args.contextDescription}. Use this visual context to understand what the user is referring to.`,
			);
		}

		const system = systemParts.join("\n");

		// Build message content - text and optionally image
		const userContent: Array<
			{ type: "text"; text: string } | { type: "image"; image: string }
		> = [];

		// Add image context if provided
		if (args.imageContext) {
			userContent.push({
				type: "image",
				image: args.imageContext,
			});
		}

		// Add user text
		userContent.push({ type: "text", text: args.input });

		// Generate structured output
		const { object } = await generateObject({
			model: "google/gemini-3-flash",
			system,
			messages: [{ role: "user", content: userContent }],
			schema: z.object({ commands: z.array(CommandSchema) }).strict(),
			temperature: 0.1,
			maxRetries: 3,
			providerOptions: {
				google: {
					thinkingConfig: {
						includeThoughts: false,
						thinkingLevel: "minimal",
					},
				} satisfies GoogleGenerativeAIProviderOptions,
			},
		});

		console.log("canvas_ai.final", object);
		const commands: Array<CanvasCommand> = Array.isArray(object?.commands)
			? (object.commands as Array<CanvasCommand>)
			: [];
		return { commands };
	},
});
