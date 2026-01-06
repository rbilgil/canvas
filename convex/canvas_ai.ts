"use node";

import { type GoogleGenerativeAIProviderOptions, google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
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

// Hex color validation
const hexColor = z
	.string()
	.regex(
		/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/,
		"HEX color like #RRGGBB or #RGB",
	);

// Tool parameter schemas (without the "tool" discriminator field)
const MoveParams = z.object({
	id: z
		.string()
		.optional()
		.describe(
			"The shape ID to move. Required when multiple shapes are selected.",
		),
	dx: z
		.number()
		.describe(
			"Pixels to move horizontally. Positive = right, negative = left.",
		),
	dy: z
		.number()
		.describe("Pixels to move vertically. Positive = down, negative = up."),
});

const ResizeParams = z.object({
	id: z
		.string()
		.optional()
		.describe(
			"The shape ID to resize. Required when multiple shapes are selected.",
		),
	width: z.number().optional().describe("New width in pixels."),
	height: z.number().optional().describe("New height in pixels."),
	scale: z
		.number()
		.optional()
		.describe(
			"Scale factor. Use this for 'bigger/smaller' requests (e.g., 1.5 = 50% bigger, 0.5 = half size).",
		),
});

const ChangeColorParams = z.object({
	id: z
		.string()
		.optional()
		.describe(
			"The shape ID to recolor. Required when multiple shapes are selected.",
		),
	fill: hexColor
		.optional()
		.describe("New fill color as HEX (#RRGGBB or #RGB)."),
	stroke: hexColor
		.optional()
		.describe("New stroke/border color as HEX (#RRGGBB or #RGB)."),
});

const GenerateSvgParams = z.object({
	id: z
		.string()
		.optional()
		.describe("Optional shape ID to replace with the SVG."),
	svg: z.string().describe("Complete SVG markup string (<svg>...</svg>)."),
	x: z.number().optional().describe("X position on canvas."),
	y: z.number().optional().describe("Y position on canvas."),
	width: z.number().optional().describe("Width of the SVG."),
	height: z.number().optional().describe("Height of the SVG."),
});

const GenerateImageParams = z.object({
	id: z
		.string()
		.optional()
		.describe("Optional shape ID to replace with the image."),
	prompt: z.string().describe("Description of the image to generate."),
	x: z.number().optional().describe("X position on canvas."),
	y: z.number().optional().describe("Y position on canvas."),
	width: z.number().optional().describe("Width of the image."),
	height: z.number().optional().describe("Height of the image."),
});

const EditImageParams = z.object({
	id: z.string().optional().describe("The image shape ID to edit."),
	prompt: z.string().describe("Description of how to edit the image."),
});

const CombineSelectionParams = z.object({});

// Define the tools
const canvasTools = {
	moveObject: tool({
		description:
			"Move one or more shapes by a relative offset. Call multiple times to move multiple shapes.",

		inputSchema: MoveParams,
	}),
	resize: tool({
		description:
			"Resize a shape. Use 'scale' for relative sizing (bigger/smaller) or width/height for absolute dimensions.",
		inputSchema: ResizeParams,
	}),
	changeColor: tool({
		description:
			"Change the fill and/or stroke color of a shape. Colors must be HEX codes.",
		inputSchema: ChangeColorParams,
	}),
	generateSvg: tool({
		description: "Generate and insert SVG vector art onto the canvas.",
		inputSchema: GenerateSvgParams,
	}),
	generateImage: tool({
		description:
			"Generate a raster image from a text prompt and place it on the canvas.",
		inputSchema: GenerateImageParams,
	}),
	editImage: tool({
		description: "Edit an existing image on the canvas using a text prompt.",
		inputSchema: EditImageParams,
	}),
	combineSelection: tool({
		description:
			"Merge all currently selected shapes into a single raster image.",
		inputSchema: CombineSelectionParams,
	}),
};

// Command types for the return value
export type CanvasCommand =
	| { tool: "moveObject"; id?: string; target?: string; dx: number; dy: number }
	| {
			tool: "resize";
			id?: string;
			target?: string;
			width?: number;
			height?: number;
			scale?: number;
	  }
	| {
			tool: "changeColor";
			id?: string;
			target?: string;
			fill?: string;
			stroke?: string;
	  }
	| {
			tool: "generateSvg";
			id?: string;
			svg: string;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
	  }
	| {
			tool: "generateImage";
			id?: string;
			prompt: string;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
	  }
	| { tool: "editImage"; id?: string; prompt: string }
	| { tool: "combineSelection" };

// Schema for selected shape info passed to the AI
const SelectedShapeInfo = v.object({
	id: v.string(),
	type: v.string(),
	x: v.number(),
	y: v.number(),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
	fill: v.optional(v.string()),
	stroke: v.optional(v.string()),
	text: v.optional(v.string()),
});

export const interpret = action({
	args: {
		input: v.string(),
		// Optional visual context as base64 data URL
		imageContext: v.optional(v.string()),
		// Description of what the image shows (e.g., "selected rect shape", "full canvas")
		contextDescription: v.optional(v.string()),
		// Structured info about selected shapes so AI can reference them by ID
		selectedShapes: v.optional(v.array(SelectedShapeInfo)),
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
			"Use the provided tools to execute the user's request. You can call multiple tools in one response.",
			"If the user's intent is ambiguous, make a sensible default choice.",
		];

		// Add context description if provided
		if (args.contextDescription) {
			systemParts.push(
				`\nYou are looking at: ${args.contextDescription}. Use this visual context to understand what the user is referring to.`,
			);
		}

		// Add selected shapes info for multi-element operations
		if (args.selectedShapes && args.selectedShapes.length > 0) {
			systemParts.push(
				"\n## Selected Shapes",
				"The user has selected the following shapes. Use the 'id' parameter to target specific shapes:",
				JSON.stringify(args.selectedShapes, null, 2),
				"\nWhen the user asks to modify multiple elements (e.g., 'bring these closer', 'make them all red', 'align these'), call the appropriate tool once for each shape.",
				"For spatial operations like 'bring closer together', calculate appropriate dx/dy values based on shape positions to move them toward their center.",
			);
		} else {
			systemParts.push(
				"If there's a single selected shape, you can omit the 'id' parameter and the client will apply it to the selection.",
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

		// Generate with tools
		const result = await generateText({
			model: "google/gemini-3-flash",
			system,
			messages: [{ role: "user", content: userContent }],
			tools: canvasTools,
			stopWhen: stepCountIs(1),
			providerOptions: {
				google: {
					thinkingConfig: {
						includeThoughts: false,
						thinkingLevel: "low",
					},
				} satisfies GoogleGenerativeAIProviderOptions,
			},
		});

		// Extract tool calls as commands
		const commands: CanvasCommand[] = [];
		for (const step of result.steps) {
			for (const toolCall of step.toolCalls) {
				const toolName = toolCall.toolName as keyof typeof canvasTools;
				const toolArgs = toolCall.input as Record<string, unknown>;

				// Convert tool call to command format
				commands.push({
					tool: toolName,
					...toolArgs,
				} as CanvasCommand);
			}
		}

		console.log("canvas_ai.final", { commands });
		return { commands };
	},
});
