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

// Shape creation parameter schemas
const CreateRectParams = z.object({
	x: z.number().describe("X position on canvas."),
	y: z.number().describe("Y position on canvas."),
	width: z.number().describe("Width of the rectangle."),
	height: z.number().describe("Height of the rectangle."),
	fill: hexColor.optional().describe("Fill color as HEX (#RRGGBB or #RGB)."),
	stroke: hexColor.optional().describe("Stroke color as HEX (#RRGGBB or #RGB)."),
	strokeWidth: z.number().optional().describe("Stroke width in pixels."),
	radius: z.number().optional().describe("Corner radius for rounded rectangles."),
});

const CreateEllipseParams = z.object({
	x: z.number().describe("X position (center) on canvas."),
	y: z.number().describe("Y position (center) on canvas."),
	width: z.number().describe("Width of the ellipse."),
	height: z.number().describe("Height of the ellipse."),
	fill: hexColor.optional().describe("Fill color as HEX (#RRGGBB or #RGB)."),
	stroke: hexColor.optional().describe("Stroke color as HEX (#RRGGBB or #RGB)."),
	strokeWidth: z.number().optional().describe("Stroke width in pixels."),
});

const CreateLineParams = z.object({
	x1: z.number().describe("X position of start point."),
	y1: z.number().describe("Y position of start point."),
	x2: z.number().describe("X position of end point."),
	y2: z.number().describe("Y position of end point."),
	stroke: hexColor.optional().describe("Line color as HEX (#RRGGBB or #RGB)."),
	strokeWidth: z.number().optional().describe("Line width in pixels."),
});

const TextShadowParams = z.object({
	color: hexColor.describe("Shadow color as HEX."),
	blur: z.number().describe("Shadow blur radius in pixels."),
	offsetX: z.number().describe("Shadow horizontal offset in pixels."),
	offsetY: z.number().describe("Shadow vertical offset in pixels."),
});

const CreateTextParams = z.object({
	text: z.string().describe("The text content to display."),
	x: z.number().describe("X position on canvas."),
	y: z.number().describe("Y position on canvas."),
	fontSize: z.number().optional().describe("Font size in pixels. Default is 20."),
	fontWeight: z
		.string()
		.optional()
		.describe(
			"Font weight: '100' to '900', 'normal', or 'bold'. Default is '400'.",
		),
	fontFamily: z
		.string()
		.optional()
		.describe("Font family name. Default is system UI font."),
	fill: hexColor.optional().describe("Text color as HEX (#RRGGBB or #RGB)."),
	stroke: hexColor
		.optional()
		.describe("Text outline/stroke color as HEX (#RRGGBB or #RGB)."),
	strokeWidth: z.number().optional().describe("Text outline width in pixels."),
	shadow: TextShadowParams.optional().describe("Text shadow effect."),
});

// Edit text parameters - for modifying existing text elements
const EditTextParams = z.object({
	id: z
		.string()
		.optional()
		.describe("The text shape ID to edit. If omitted, applies to current selection."),
	text: z.string().optional().describe("New text content."),
	fontSize: z.number().optional().describe("New font size in pixels."),
	fontWeight: z
		.string()
		.optional()
		.describe("New font weight: '100' to '900', 'normal', or 'bold'."),
	fontFamily: z.string().optional().describe("New font family name."),
	shadow: TextShadowParams.optional().describe("Text shadow effect. Set to add/update shadow."),
});

// Z-order parameter schemas
const ZOrderParams = z.object({
	id: z
		.string()
		.optional()
		.describe(
			"The shape ID to reorder. If omitted, applies to current selection.",
		),
});

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
	editText: tool({
		description:
			"Edit an existing text element's properties: content, font size, font weight (bold/normal), font family, or shadow. Use this to modify selected text.",
		inputSchema: EditTextParams,
	}),
	combineSelection: tool({
		description:
			"Merge all currently selected shapes into a single raster image.",
		inputSchema: CombineSelectionParams,
	}),
	// Shape creation tools
	createRect: tool({
		description:
			"Create a rectangle on the canvas. Specify position, dimensions, and optionally colors and corner radius.",
		inputSchema: CreateRectParams,
	}),
	createEllipse: tool({
		description:
			"Create an ellipse or circle on the canvas. For a circle, use equal width and height.",
		inputSchema: CreateEllipseParams,
	}),
	createLine: tool({
		description: "Create a line between two points on the canvas.",
		inputSchema: CreateLineParams,
	}),
	createText: tool({
		description:
			"Create text on the canvas with customizable styling including font size, weight, family, color, stroke outline, and shadow effects.",
		inputSchema: CreateTextParams,
	}),
	// Z-order tools
	bringToFront: tool({
		description: "Bring shape(s) to the front (top of the layer stack).",
		inputSchema: ZOrderParams,
	}),
	sendToBack: tool({
		description: "Send shape(s) to the back (bottom of the layer stack).",
		inputSchema: ZOrderParams,
	}),
	moveUp: tool({
		description: "Move shape(s) one level up in the layer stack.",
		inputSchema: ZOrderParams,
	}),
	moveDown: tool({
		description: "Move shape(s) one level down in the layer stack.",
		inputSchema: ZOrderParams,
	}),
};

// Command types for the return value
export type TextShadow = {
	color: string;
	blur: number;
	offsetX: number;
	offsetY: number;
};

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
	| {
			tool: "editText";
			id?: string;
			text?: string;
			fontSize?: number;
			fontWeight?: string;
			fontFamily?: string;
			shadow?: TextShadow;
	  }
	| { tool: "combineSelection" }
	// Shape creation commands
	| {
			tool: "createRect";
			x: number;
			y: number;
			width: number;
			height: number;
			fill?: string;
			stroke?: string;
			strokeWidth?: number;
			radius?: number;
	  }
	| {
			tool: "createEllipse";
			x: number;
			y: number;
			width: number;
			height: number;
			fill?: string;
			stroke?: string;
			strokeWidth?: number;
	  }
	| {
			tool: "createLine";
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			stroke?: string;
			strokeWidth?: number;
	  }
	| {
			tool: "createText";
			text: string;
			x: number;
			y: number;
			fontSize?: number;
			fontWeight?: string;
			fontFamily?: string;
			fill?: string;
			stroke?: string;
			strokeWidth?: number;
			shadow?: TextShadow;
	  }
	// Z-order commands
	| { tool: "bringToFront"; id?: string }
	| { tool: "sendToBack"; id?: string }
	| { tool: "moveUp"; id?: string }
	| { tool: "moveDown"; id?: string };

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
					tool: v.literal("editText"),
					id: v.optional(v.string()),
					text: v.optional(v.string()),
					fontSize: v.optional(v.number()),
					fontWeight: v.optional(v.string()),
					fontFamily: v.optional(v.string()),
					shadow: v.optional(
						v.object({
							color: v.string(),
							blur: v.number(),
							offsetX: v.number(),
							offsetY: v.number(),
						}),
					),
				}),
				v.object({
					tool: v.literal("combineSelection"),
				}),
				// Shape creation commands
				v.object({
					tool: v.literal("createRect"),
					x: v.number(),
					y: v.number(),
					width: v.number(),
					height: v.number(),
					fill: v.optional(v.string()),
					stroke: v.optional(v.string()),
					strokeWidth: v.optional(v.number()),
					radius: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("createEllipse"),
					x: v.number(),
					y: v.number(),
					width: v.number(),
					height: v.number(),
					fill: v.optional(v.string()),
					stroke: v.optional(v.string()),
					strokeWidth: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("createLine"),
					x1: v.number(),
					y1: v.number(),
					x2: v.number(),
					y2: v.number(),
					stroke: v.optional(v.string()),
					strokeWidth: v.optional(v.number()),
				}),
				v.object({
					tool: v.literal("createText"),
					text: v.string(),
					x: v.number(),
					y: v.number(),
					fontSize: v.optional(v.number()),
					fontWeight: v.optional(v.string()),
					fontFamily: v.optional(v.string()),
					fill: v.optional(v.string()),
					stroke: v.optional(v.string()),
					strokeWidth: v.optional(v.number()),
					shadow: v.optional(
						v.object({
							color: v.string(),
							blur: v.number(),
							offsetX: v.number(),
							offsetY: v.number(),
						}),
					),
				}),
				// Z-order commands
				v.object({
					tool: v.literal("bringToFront"),
					id: v.optional(v.string()),
				}),
				v.object({
					tool: v.literal("sendToBack"),
					id: v.optional(v.string()),
				}),
				v.object({
					tool: v.literal("moveUp"),
					id: v.optional(v.string()),
				}),
				v.object({
					tool: v.literal("moveDown"),
					id: v.optional(v.string()),
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

// Helper to generate human-readable label from a tool call
function generateLabel(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "moveObject": {
			const dx = args.dx as number;
			const dy = args.dy as number;
			if (Math.abs(dx) > Math.abs(dy)) {
				return dx > 0 ? "Move right" : "Move left";
			}
			return dy > 0 ? "Move down" : "Move up";
		}
		case "resize": {
			if (args.scale !== undefined) {
				const scale = args.scale as number;
				return scale > 1 ? `Make ${Math.round((scale - 1) * 100)}% bigger` : `Make ${Math.round((1 - scale) * 100)}% smaller`;
			}
			return "Resize";
		}
		case "changeColor":
			if (args.fill) return `Paint ${args.fill}`;
			if (args.stroke) return `Stroke ${args.stroke}`;
			return "Change color";
		case "generateSvg":
			return "Generate SVG";
		case "generateImage":
			return `Generate ${(args.prompt as string)?.slice(0, 20) || "image"}...`;
		case "editImage":
			return `Edit: ${(args.prompt as string)?.slice(0, 20) || "image"}...`;
		case "editText": {
			if (args.fontWeight === "bold" || args.fontWeight === "700") return "Make bold";
			if (args.fontWeight === "normal" || args.fontWeight === "400") return "Make normal weight";
			if (args.fontSize) return `Set font size to ${args.fontSize}px`;
			if (args.fontFamily) return `Change font to ${args.fontFamily}`;
			if (args.shadow) return "Add text shadow";
			if (args.text) return `Change text to "${(args.text as string).slice(0, 15)}..."`;
			return "Edit text";
		}
		case "combineSelection":
			return "Combine into one";
		case "createRect":
			return `Add ${args.fill || "a"} rectangle`;
		case "createEllipse":
			return `Add ${args.fill || "a"} circle`;
		case "createLine":
			return "Add a line";
		case "createText":
			return `Add text "${(args.text as string)?.slice(0, 15) || ""}"`;
		case "bringToFront":
			return "Bring to front";
		case "sendToBack":
			return "Send to back";
		case "moveUp":
			return "Move up one layer";
		case "moveDown":
			return "Move down one layer";
		default:
			return toolName;
	}
}

// Action to suggest contextual actions for the right-click menu
export const suggestActions = action({
	args: {
		imageContext: v.optional(v.string()),
		contextDescription: v.optional(v.string()),
		selectedShapes: v.optional(v.array(SelectedShapeInfo)),
	},
	returns: v.object({
		suggestions: v.array(
			v.object({
				label: v.string(),
				command: v.union(
					v.object({
						tool: v.literal("moveObject"),
						id: v.optional(v.string()),
						dx: v.number(),
						dy: v.number(),
					}),
					v.object({
						tool: v.literal("resize"),
						id: v.optional(v.string()),
						width: v.optional(v.number()),
						height: v.optional(v.number()),
						scale: v.optional(v.number()),
					}),
					v.object({
						tool: v.literal("changeColor"),
						id: v.optional(v.string()),
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
						tool: v.literal("editText"),
						id: v.optional(v.string()),
						text: v.optional(v.string()),
						fontSize: v.optional(v.number()),
						fontWeight: v.optional(v.string()),
						fontFamily: v.optional(v.string()),
						shadow: v.optional(
							v.object({
								color: v.string(),
								blur: v.number(),
								offsetX: v.number(),
								offsetY: v.number(),
							}),
						),
					}),
					v.object({
						tool: v.literal("combineSelection"),
					}),
					v.object({
						tool: v.literal("createRect"),
						x: v.number(),
						y: v.number(),
						width: v.number(),
						height: v.number(),
						fill: v.optional(v.string()),
						stroke: v.optional(v.string()),
						strokeWidth: v.optional(v.number()),
						radius: v.optional(v.number()),
					}),
					v.object({
						tool: v.literal("createEllipse"),
						x: v.number(),
						y: v.number(),
						width: v.number(),
						height: v.number(),
						fill: v.optional(v.string()),
						stroke: v.optional(v.string()),
						strokeWidth: v.optional(v.number()),
					}),
					v.object({
						tool: v.literal("createLine"),
						x1: v.number(),
						y1: v.number(),
						x2: v.number(),
						y2: v.number(),
						stroke: v.optional(v.string()),
						strokeWidth: v.optional(v.number()),
					}),
					v.object({
						tool: v.literal("createText"),
						text: v.string(),
						x: v.number(),
						y: v.number(),
						fontSize: v.optional(v.number()),
						fontWeight: v.optional(v.string()),
						fontFamily: v.optional(v.string()),
						fill: v.optional(v.string()),
						stroke: v.optional(v.string()),
						strokeWidth: v.optional(v.number()),
						shadow: v.optional(
							v.object({
								color: v.string(),
								blur: v.number(),
								offsetX: v.number(),
								offsetY: v.number(),
							}),
						),
					}),
					v.object({
						tool: v.literal("bringToFront"),
						id: v.optional(v.string()),
					}),
					v.object({
						tool: v.literal("sendToBack"),
						id: v.optional(v.string()),
					}),
					v.object({
						tool: v.literal("moveUp"),
						id: v.optional(v.string()),
					}),
					v.object({
						tool: v.literal("moveDown"),
						id: v.optional(v.string()),
					}),
				),
			}),
		),
	}),
	handler: async (_ctx, args) => {
		// Validate model is configured
		selectModel();

		// Build context-aware system prompt
		const hasSelection = args.selectedShapes && args.selectedShapes.length > 0;
		const selectionType = hasSelection
			? args.selectedShapes!.length > 1
				? "multiple"
				: args.selectedShapes![0].type
			: "none";

		let systemPrompt = `You are a UI assistant for a vector canvas app. Suggest exactly 5 useful actions by calling 5 tools.

`;
		if (hasSelection) {
			systemPrompt += `IMPORTANT: The user has ${args.selectedShapes!.length} element(s) selected.
ALL suggestions must operate on the EXISTING selection. Do NOT suggest creating new shapes (createRect, createEllipse, createLine, createText, generateImage, generateSvg).

Only use these tools for selected elements:
- changeColor: Change fill or stroke color
- resize: Make bigger/smaller (use scale like 1.2 for 20% bigger, 0.8 for 20% smaller)
- moveObject: Move left/right/up/down (use dx/dy in pixels)
- bringToFront, sendToBack, moveUp, moveDown: Change layer order
${selectionType === "text" ? "- editText: Edit text properties (fontSize, fontWeight like 'bold'/'700', fontFamily, shadow)" : ""}
${selectionType === "image" ? "- editImage: Edit the image with AI" : ""}
${selectionType === "multiple" ? "- combineSelection: Merge selected elements into one image" : ""}

Be specific with values based on the element's current properties.`;
		} else {
			systemPrompt += `The canvas is empty or nothing is selected. Suggest creating new elements:
- createRect, createEllipse, createLine, createText: Create shapes
- generateImage: Generate an AI image

Position new elements reasonably on the canvas (e.g., x: 100-400, y: 100-300).
Use appealing colors and reasonable sizes.`;
		}

		systemPrompt += `

The tools you call will become clickable suggestion buttons for the user.`;

		// Build context
		const contextParts: string[] = [];
		if (args.contextDescription) {
			contextParts.push(`Current view: ${args.contextDescription}`);
		}
		if (args.selectedShapes && args.selectedShapes.length > 0) {
			contextParts.push(
				"Selected shapes:",
				JSON.stringify(args.selectedShapes, null, 2),
			);
		} else {
			contextParts.push("No shapes currently selected (empty canvas or nothing selected).");
		}

		const userContent: Array<
			{ type: "text"; text: string } | { type: "image"; image: string }
		> = [];

		if (args.imageContext) {
			userContent.push({ type: "image", image: args.imageContext });
		}
		userContent.push({
			type: "text",
			text: `${contextParts.join("\n")}\n\nCall exactly 5 tools to suggest actions.`,
		});

		try {
			const result = await generateText({
				model: "google/gemini-3-flash",
				system: systemPrompt,
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

			// Tools that create new elements (should be filtered when something is selected)
			const creationTools = new Set([
				"createRect",
				"createEllipse",
				"createLine",
				"createText",
				"generateImage",
				"generateSvg",
			]);

			// Extract tool calls as suggestions with auto-generated labels
			const suggestions: Array<{
				label: string;
				command: CanvasCommand;
			}> = [];

			for (const step of result.steps) {
				for (const toolCall of step.toolCalls) {
					if (suggestions.length >= 5) break;
					const toolName = toolCall.toolName as keyof typeof canvasTools;
					const toolArgs = toolCall.input as Record<string, unknown>;

					// Filter out creation tools when something is selected
					if (hasSelection && creationTools.has(toolName)) {
						continue;
					}

					suggestions.push({
						label: generateLabel(toolName, toolArgs),
						command: {
							tool: toolName,
							...toolArgs,
						} as CanvasCommand,
					});
				}
			}

			console.log("suggestActions.result", { suggestions });
			return { suggestions };
		} catch (error) {
			console.error("suggestActions error:", error);
			return { suggestions: [] };
		}
	},
});
