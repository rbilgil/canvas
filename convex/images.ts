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
		// Optional reference image (canvas context) for image-to-image generation
		referenceImageUrl: v.optional(v.string()),
	},
	returns: v.object({
		storageUrl: v.string(),
		storageId: v.id("_storage"),
		mimeType: v.string(),
		width: v.number(),
		height: v.number(),
	}),
	handler: async (ctx, args) => {
		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

		// Build message content - optionally include reference image
		const content: Array<
			| { type: "text"; text: string }
			| { type: "file"; data: Uint8Array; mediaType: string }
		> = [];

		// Add reference image if provided
		if (args.referenceImageUrl) {
			const { mime, bytes } = await getImageBytes(args.referenceImageUrl);
			content.push({ type: "file", data: bytes, mediaType: mime });
		}

		// Add text prompt
		content.push({ type: "text", text: args.prompt });

		const { files } = await generateText({
			model: "google/gemini-2.5-flash-image-preview",
			messages: [{ role: "user", content }],
			providerOptions: {
				google: { responseModalities: ["IMAGE"] },
			},
		});
		const imageFile = files.at(0);
		if (!imageFile) throw new Error("Gemini did not return an image");

		// Upload to Convex storage instead of returning base64
		const imageBytes = Buffer.from(imageFile.base64, "base64");
		const blob = new Blob([imageBytes], { type: imageFile.mediaType });
		const storageId = await ctx.storage.store(blob);
		const storageUrl = await ctx.storage.getUrl(storageId);
		if (!storageUrl) throw new Error("Failed to get storage URL");

		// Extract actual dimensions from the image
		const dimensions = getImageDimensions(imageBytes, imageFile.mediaType);
		return {
			storageUrl,
			storageId,
			mimeType: imageFile.mediaType,
			width: dimensions.width,
			height: dimensions.height,
		};
	},
});

// Extract image dimensions from buffer by parsing image headers
function getImageDimensions(
	buffer: Buffer,
	mimeType: string,
): { width: number; height: number } {
	try {
		if (mimeType === "image/png") {
			// PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
			if (buffer.length >= 24 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") {
				const width = buffer.readUInt32BE(16);
				const height = buffer.readUInt32BE(20);
				return { width, height };
			}
		} else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
			// JPEG: scan for SOF0/SOF2 marker (0xFFC0 or 0xFFC2)
			let offset = 2; // Skip SOI marker
			while (offset < buffer.length - 8) {
				if (buffer[offset] !== 0xff) {
					offset++;
					continue;
				}
				const marker = buffer[offset + 1];
				// SOF0, SOF1, SOF2 markers contain dimensions
				if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
					const height = buffer.readUInt16BE(offset + 5);
					const width = buffer.readUInt16BE(offset + 7);
					return { width, height };
				}
				// Skip to next marker
				const segmentLength = buffer.readUInt16BE(offset + 2);
				offset += 2 + segmentLength;
			}
		} else if (mimeType === "image/webp") {
			// WebP: Check for VP8/VP8L/VP8X chunks
			if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF") {
				const format = buffer.toString("ascii", 12, 16);
				if (format === "VP8 ") {
					// Lossy WebP
					const width = buffer.readUInt16LE(26) & 0x3fff;
					const height = buffer.readUInt16LE(28) & 0x3fff;
					return { width, height };
				} else if (format === "VP8L") {
					// Lossless WebP
					const bits = buffer.readUInt32LE(21);
					const width = (bits & 0x3fff) + 1;
					const height = ((bits >> 14) & 0x3fff) + 1;
					return { width, height };
				}
			}
		}
	} catch (e) {
		console.warn("Failed to parse image dimensions:", e);
	}
	// Fallback to default dimensions
	return { width: 512, height: 512 };
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
	const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
	if (!match) throw new Error("Invalid data URL");
	const mime = match[1] || "image/png";
	const b64 = match[2];
	const buf = Buffer.from(b64, "base64");
	return { mime, bytes: new Uint8Array(buf) };
}

async function getImageBytes(
	imageUrl: string,
): Promise<{ mime: string; bytes: Uint8Array }> {
	// Handle data URLs
	if (imageUrl.startsWith("data:")) {
		return parseDataUrl(imageUrl);
	}

	// Handle regular URLs - fetch the image
	const response = await fetch(imageUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.status}`);
	}
	const arrayBuffer = await response.arrayBuffer();
	const mime = response.headers.get("content-type") || "image/png";
	return { mime, bytes: new Uint8Array(arrayBuffer) };
}

export const editCanvasImage = action({
	args: {
		imageUrl: v.string(),
		prompt: v.string(),
	},
	returns: v.object({
		storageUrl: v.string(),
		storageId: v.id("_storage"),
		mimeType: v.string(),
	}),
	handler: async (ctx, args) => {
		const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

		const { mime, bytes } = await getImageBytes(args.imageUrl);
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

		// Upload to Convex storage instead of returning base64
		const imageBytes = Buffer.from(imageFile.base64, "base64");
		const blob = new Blob([imageBytes], { type: imageFile.mediaType });
		const storageId = await ctx.storage.store(blob);
		const storageUrl = await ctx.storage.getUrl(storageId);
		if (!storageUrl) throw new Error("Failed to get storage URL");

		return { storageUrl, storageId, mimeType: imageFile.mediaType };
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

// Upload an image (from data URL) to Convex storage
export const uploadImage = action({
	args: {
		dataUrl: v.string(),
	},
	returns: v.object({
		storageUrl: v.string(),
		storageId: v.id("_storage"),
		mimeType: v.string(),
	}),
	handler: async (ctx, args) => {
		const { mime, bytes } = parseDataUrl(args.dataUrl);
		const blob = new Blob([Buffer.from(bytes)], { type: mime });
		const storageId = await ctx.storage.store(blob);
		const storageUrl = await ctx.storage.getUrl(storageId);
		if (!storageUrl) throw new Error("Failed to get storage URL");
		return { storageUrl, storageId, mimeType: mime };
	},
});
