"use node";

import { generateText, type ModelMessage } from "ai";
import { v } from "convex/values";
import { action } from "./_generated/server";

const PORTRAIT_STYLES = [
	{
		id: "modern-pro",
		label: "Modern Pro",
		prompt:
			"Create a color studio portrait of this person in the style of Peter Hurley. It needs to feel modern, approachable, and polished, with a clean, softly graded background. A bright, high-resolution close-up headshot with natural skin tones and crisp catchlights. The subject is angled slightly toward the camera with relaxed confidence, offering a subtle smile.",
	},
	{
		id: "studio-editorial",
		label: "Studio Editorial",
		prompt:
			"Create an editorial studio portrait of this person in the style of Annie Leibovitz. It needs to have a cinematic, timeless feel, with a textured, neutral backdrop and nuanced, directional lighting. A rich, color close-up portrait with gentle falloff and soft rim light. The subject is seated three-quarter to camera, composed and thoughtful, with a calm, assured expression.",
	},
	{
		id: "creative-social",
		label: "Creative Social",
		prompt:
			"Create a monochrome studio portrait of this person in the style of Ryan Pfluger. It needs to have a creative, relaxed feel, and a light background. A striking, black and white close-up portrait. The subject is looking up and slightly to his right, with a focused and thoughtful expression.",
	},
	{
		id: "cinematic-neon",
		label: "Cinematic Neon",
		prompt:
			"Create a cinematic night portrait of this person influenced by neon-lit color theory and shallow depth of field. It needs to feel moody and modern, with saturated magenta and cyan gels against a dark, gradient background that blooms into bokeh. A color close-up with glossy highlights, soft falloff, and subtle grain. The subject is slightly off-axis to camera, reflective and calm, eyes catching a vivid neon accent.",
	},
	{
		id: "classic-rembrandt",
		label: "Classic Rembrandt",
		prompt:
			"Create a classic studio portrait of this person using Rembrandt lighting. It needs to feel warm, sculpted, and timeless, with a textured, painterly backdrop and gentle film-like grain. A color close-up with rich midtones and a subtle triangle of light on the shadow cheek. The subject is turned three-quarter to camera, composed and steady, with a serene, self-assured expression.",
	},
] as const;

type PortraitStyle = (typeof PORTRAIT_STYLES)[number];

export const generatePortraits = action({
	args: {
		referenceImageId: v.id("_storage"),
	},
	returns: v.object({
		portraits: v.array(
			v.object({
				styleId: v.string(),
				label: v.string(),
				dataUrl: v.string(),
				mimeType: v.string(),
			}),
		),
	}),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable",
			);
		}

		const referenceUrl = await ctx.storage.getUrl(args.referenceImageId);
		if (!referenceUrl) {
			throw new Error("Could not load reference image");
		}

		const referenceResponse = await fetch(referenceUrl);
		if (!referenceResponse.ok) {
			throw new Error(
				`Failed to fetch reference image: ${referenceResponse.statusText}`,
			);
		}
		const referenceType =
			referenceResponse.headers.get("content-type") || "image/jpeg";
		const referenceBytes = new Uint8Array(
			await referenceResponse.arrayBuffer(),
		);

		const systemPrompt = [
			"You are a portrait retouching artist creating stylized professional profile photos.",
			"Preserve the subject's identity, facial features, skin tone, and hairstyle from the reference image.",
			"Return a single square thumbnail portrait with no watermarks or text overlays.",
		].join(" ");

		const makeMessages = (style: PortraitStyle): ModelMessage[] => [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `${systemPrompt} Apply the following stylistic direction: ${style.prompt}`,
					},
					{
						type: "file",
						data: referenceBytes,
						mediaType: referenceType,
					},
				],
			},
		];

		const portraits = await Promise.all(
			PORTRAIT_STYLES.map(async (style) => {
				const { files } = await generateText({
					model: "google/gemini-2.5-flash-image-preview",
					messages: makeMessages(style),
					providerOptions: {
						google: {
							responseModalities: ["IMAGE"],
						},
					},
				});

				const imageFile = files.at(0);
				if (!imageFile) {
					throw new Error(
						`Gemini did not return an image for style ${style.id}`,
					);
				}

				return {
					styleId: style.id,
					label: style.label,
					dataUrl: `data:${imageFile.mediaType};base64,${imageFile.base64}`,
					mimeType: imageFile.mediaType,
				};
			}),
		);

		return { portraits };
	},
});

// Canvas-specific image tools
export const generateCanvasImage = action({
	args: {
		prompt: v.string(),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
	},
	returns: v.object({
		dataUrl: v.string(),
		mimeType: v.string(),
		width: v.number(),
		height: v.number(),
	}),
	handler: async (ctx, args) => {
		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

		const { files } = await generateText({
			model: "google/gemini-2.5-flash-image-preview",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: args.prompt }],
				},
			],
			providerOptions: {
				google: { responseModalities: ["IMAGE"] },
			},
		});
		const imageFile = files.at(0);
		if (!imageFile) throw new Error("Gemini did not return an image");
		const dataUrl = `data:${imageFile.mediaType};base64,${imageFile.base64}`;
		// We don't know exact dimensions here; default to inputs if provided or 512
		const width = args.width ?? 512;
		const height = args.height ?? 512;
		return { dataUrl, mimeType: imageFile.mediaType, width, height };
	},
});

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
	const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
	if (!match) throw new Error("Invalid data URL");
	const mime = match[1] || "image/png";
	const b64 = match[2];
	const buf = Buffer.from(b64, "base64");
	return { mime, bytes: new Uint8Array(buf) };
}

export const editCanvasImage = action({
	args: {
		dataUrl: v.string(),
		prompt: v.string(),
	},
	returns: v.object({
		dataUrl: v.string(),
		mimeType: v.string(),
	}),
	handler: async (_ctx, args) => {
		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

		const { mime, bytes } = parseDataUrl(args.dataUrl);
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: args.prompt },
					{ type: "file", data: bytes, mediaType: mime },
				],
			},
		];
		const { files } = await generateText({
			model: "google/gemini-2.5-flash-image-preview",
			messages,
			providerOptions: {
				google: { responseModalities: ["IMAGE"] },
			},
		});
		console.log("got response from editCanvasImage", files);
		const imageFile = files[files.length - 1];
		if (!imageFile) throw new Error("Gemini did not return an edited image");
		const dataUrl = `data:${imageFile.mediaType};base64,${imageFile.base64}`;
		return { dataUrl, mimeType: imageFile.mediaType };
	},
});

export const fuseCanvasImages = action({
	args: {
		images: v.array(
			v.object({
				dataUrl: v.string(),
				label: v.optional(v.string()),
			}),
		),
		prompt: v.optional(v.string()),
	},
	returns: v.object({
		dataUrl: v.string(),
		mimeType: v.string(),
	}),
	handler: async (_ctx, args) => {
		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

		const instruction =
			args.prompt ||
			"Combine all provided images into a single coherent image. Respect subject integrity, blend naturally, and ignore any transparent backgrounds.";

		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: instruction },
					...args.images.map((img) => {
						const { mime, bytes } = parseDataUrl(img.dataUrl);
						return { type: "file", data: bytes, mediaType: mime } as const;
					}),
				],
			},
		];

		const { files: outFiles } = await generateText({
			model: "google/gemini-2.5-flash-image-preview",
			messages,
			providerOptions: {
				google: { responseModalities: ["IMAGE"] },
			},
		});

		const imageFile = outFiles[outFiles.length - 1];
		if (!imageFile) throw new Error("Gemini did not return a fused image");
		const dataUrl = `data:${imageFile.mediaType};base64,${imageFile.base64}`;
		return { dataUrl, mimeType: imageFile.mediaType };
	},
});
