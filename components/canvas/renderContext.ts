/**
 * Render canvas shapes to an image for AI context
 */

import type { CanvasShape } from "./types";

// Maximum dimension for context images (keeps them efficient to transfer)
const MAX_CONTEXT_SIZE = 1024;

/**
 * Get the bounding box of a shape
 */
function getShapeBounds(s: CanvasShape): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	if (
		s.type === "rect" ||
		s.type === "ellipse" ||
		s.type === "image" ||
		s.type === "svg"
	) {
		return { x: s.x, y: s.y, width: s.width, height: s.height };
	}
	if (s.type === "line") {
		const x1 = Math.min(s.x, s.x2);
		const y1 = Math.min(s.y, s.y2);
		return {
			x: x1,
			y: y1,
			width: Math.abs(s.x2 - s.x) || 1,
			height: Math.abs(s.y2 - s.y) || 1,
		};
	}
	if (s.type === "text") {
		const w = Math.max(40, (s.text.length || 1) * (s.fontSize * 0.6));
		const h = s.fontSize * 1.4;
		return { x: s.x, y: s.y, width: w, height: h };
	}
	if (s.type === "path") {
		if (s.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
		const xs = s.points.map((p) => p.x);
		const ys = s.points.map((p) => p.y);
		const minX = Math.min(...xs);
		const minY = Math.min(...ys);
		const maxX = Math.max(...xs);
		const maxY = Math.max(...ys);
		return {
			x: minX,
			y: minY,
			width: maxX - minX || 1,
			height: maxY - minY || 1,
		};
	}
	return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Get the combined bounding box of multiple shapes
 */
function getCombinedBounds(shapes: CanvasShape[]): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	if (shapes.length === 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const bounds = shapes.map((s) => getShapeBounds(s));
	const minX = Math.min(...bounds.map((b) => b.x));
	const minY = Math.min(...bounds.map((b) => b.y));
	const maxX = Math.max(...bounds.map((b) => b.x + b.width));
	const maxY = Math.max(...bounds.map((b) => b.y + b.height));

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/**
 * Render a single shape to a canvas context
 */
async function renderShapeToCanvas(
	ctx: CanvasRenderingContext2D,
	shape: CanvasShape,
	offsetX: number,
	offsetY: number,
): Promise<void> {
	const x = shape.x - offsetX;
	const y = shape.y - offsetY;
	const opacity = shape.opacity ?? 1;

	ctx.save();
	ctx.globalAlpha = opacity;

	if (shape.type === "rect") {
		ctx.beginPath();
		ctx.rect(x, y, shape.width, shape.height);
		if (shape.fill && shape.fill !== "transparent") {
			ctx.fillStyle = shape.fill;
			ctx.fill();
		}
		if (shape.stroke && (shape.strokeWidth ?? 0) > 0) {
			ctx.strokeStyle = shape.stroke;
			ctx.lineWidth = shape.strokeWidth ?? 1;
			ctx.stroke();
		}
	} else if (shape.type === "ellipse") {
		ctx.beginPath();
		ctx.ellipse(
			x + shape.width / 2,
			y + shape.height / 2,
			shape.width / 2,
			shape.height / 2,
			0,
			0,
			Math.PI * 2,
		);
		if (shape.fill && shape.fill !== "transparent") {
			ctx.fillStyle = shape.fill;
			ctx.fill();
		}
		if (shape.stroke && (shape.strokeWidth ?? 0) > 0) {
			ctx.strokeStyle = shape.stroke;
			ctx.lineWidth = shape.strokeWidth ?? 1;
			ctx.stroke();
		}
	} else if (shape.type === "line") {
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(shape.x2 - offsetX, shape.y2 - offsetY);
		ctx.strokeStyle = shape.stroke || "#0f172a";
		ctx.lineWidth = shape.strokeWidth || 2;
		ctx.stroke();
	} else if (shape.type === "text") {
		const fontWeight = shape.fontWeight || "400";
		const fontFamily =
			shape.fontFamily || "ui-sans-serif, system-ui, sans-serif";
		ctx.font = `${fontWeight} ${shape.fontSize}px ${fontFamily}`;
		ctx.textBaseline = "top";
		if (shape.fill) {
			ctx.fillStyle = shape.fill;
			ctx.fillText(shape.text, x, y);
		}
		if (shape.stroke && (shape.strokeWidth ?? 0) > 0) {
			ctx.strokeStyle = shape.stroke;
			ctx.lineWidth = shape.strokeWidth ?? 1;
			ctx.strokeText(shape.text, x, y);
		}
	} else if (shape.type === "image") {
		await new Promise<void>((resolve) => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = () => {
				// Mimic SVG <image> default preserveAspectRatio="xMidYMid meet" behavior:
				// Scale image to fit within shape bounds while preserving aspect ratio, centered
				const imgAspect = img.naturalWidth / img.naturalHeight;
				const shapeAspect = shape.width / shape.height;
				let drawWidth = shape.width;
				let drawHeight = shape.height;
				let drawX = x;
				let drawY = y;

				if (imgAspect > shapeAspect) {
					// Image is wider than shape - fit to width, center vertically
					drawHeight = shape.width / imgAspect;
					drawY = y + (shape.height - drawHeight) / 2;
				} else {
					// Image is taller than shape - fit to height, center horizontally
					drawWidth = shape.height * imgAspect;
					drawX = x + (shape.width - drawWidth) / 2;
				}

				ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
				resolve();
			};
			img.onerror = () => resolve();
			img.src = shape.href;
		});
	} else if (shape.type === "svg") {
		await new Promise<void>((resolve) => {
			const img = new Image();
			img.onload = () => {
				ctx.drawImage(img, x, y, shape.width, shape.height);
				resolve();
			};
			img.onerror = () => resolve();
			img.src = `data:image/svg+xml;utf8,${encodeURIComponent(shape.svg)}`;
		});
	} else if (shape.type === "path") {
		const strokeWidth = shape.strokeWidth || 4;
		if (shape.points.length === 1) {
			// Single point - render as a dot
			const pt = shape.points[0];
			const dotRadius = strokeWidth / 2 + 2;
			ctx.beginPath();
			ctx.arc(pt.x - offsetX, pt.y - offsetY, dotRadius, 0, Math.PI * 2);
			ctx.fillStyle = shape.stroke || "#0f172a";
			ctx.fill();
		} else if (shape.points.length >= 2) {
			ctx.beginPath();
			for (let i = 0; i < shape.points.length; i++) {
				const pt = shape.points[i];
				// Use moveTo for first point or if moveTo flag is set (discontinuous strokes)
				if (i === 0 || pt.moveTo) {
					ctx.moveTo(pt.x - offsetX, pt.y - offsetY);
				} else {
					ctx.lineTo(pt.x - offsetX, pt.y - offsetY);
				}
			}
			ctx.strokeStyle = shape.stroke || "#0f172a";
			ctx.lineWidth = strokeWidth;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.stroke();
		}
	}

	ctx.restore();
}

/**
 * Draw a lasso selection overlay
 */
function drawLassoOverlay(
	ctx: CanvasRenderingContext2D,
	points: Array<{ x: number; y: number }>,
	offsetX: number,
	offsetY: number,
): void {
	if (points.length < 2) return;

	ctx.save();
	ctx.strokeStyle = "#0ea5e9";
	ctx.lineWidth = 2;
	ctx.setLineDash([6, 4]);

	ctx.beginPath();
	ctx.moveTo(points[0].x - offsetX, points[0].y - offsetY);
	for (let i = 1; i < points.length; i++) {
		ctx.lineTo(points[i].x - offsetX, points[i].y - offsetY);
	}
	// Close the path
	ctx.lineTo(points[0].x - offsetX, points[0].y - offsetY);
	ctx.stroke();

	ctx.restore();
}

export interface RenderContextOptions {
	/** All shapes on the canvas */
	shapes: CanvasShape[];
	/** Canvas dimensions */
	canvasWidth: number;
	canvasHeight: number;
	/** IDs of selected shapes (optional) */
	selectedIds?: string[];
	/** Lasso points for region selection (optional) */
	lassoPoints?: Array<{ x: number; y: number }>;
}

export interface RenderedContext {
	/** Base64 data URL of the rendered image */
	dataUrl: string;
	/** Width of the rendered image */
	width: number;
	/** Height of the rendered image */
	height: number;
	/** Description of what was rendered */
	description: string;
}

/**
 * Render canvas context for AI
 *
 * - If selectedIds provided: render only those shapes
 * - If lassoPoints provided: render entire canvas with lasso overlay
 * - Otherwise: render entire canvas
 */
export async function renderCanvasContext(
	options: RenderContextOptions,
): Promise<RenderedContext> {
	const { shapes, canvasWidth, canvasHeight, selectedIds, lassoPoints } =
		options;

	let renderShapes: CanvasShape[];
	let bounds: { x: number; y: number; width: number; height: number };
	let description: string;
	let drawLasso = false;

	if (lassoPoints && lassoPoints.length > 2) {
		// Lasso mode: render entire canvas with lasso overlay
		renderShapes = shapes;
		bounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
		description = "Canvas with lasso selection region highlighted";
		drawLasso = true;
	} else if (selectedIds && selectedIds.length > 0) {
		// Selection mode: render only selected shapes
		renderShapes = shapes.filter((s) => selectedIds.includes(s.id));
		if (renderShapes.length === 0) {
			// Fallback to full canvas if selection is empty
			renderShapes = shapes;
			bounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
			description = "Full canvas (selection was empty)";
		} else {
			bounds = getCombinedBounds(renderShapes);
			// Add padding around selection
			const padding = 20;
			bounds.x = Math.max(0, bounds.x - padding);
			bounds.y = Math.max(0, bounds.y - padding);
			bounds.width = Math.min(
				canvasWidth - bounds.x,
				bounds.width + padding * 2,
			);
			bounds.height = Math.min(
				canvasHeight - bounds.y,
				bounds.height + padding * 2,
			);
			description =
				renderShapes.length === 1
					? `Selected ${renderShapes[0].type} shape`
					: `${renderShapes.length} selected shapes`;
		}
	} else {
		// No selection: render entire canvas
		renderShapes = shapes;
		bounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
		description = "Full canvas";
	}

	// Calculate scale to fit within MAX_CONTEXT_SIZE
	const scale = Math.min(
		1,
		MAX_CONTEXT_SIZE / Math.max(bounds.width, bounds.height),
	);
	const outputWidth = Math.round(bounds.width * scale);
	const outputHeight = Math.round(bounds.height * scale);

	// Create canvas
	const canvas = document.createElement("canvas");
	canvas.width = outputWidth;
	canvas.height = outputHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get canvas context");
	}

	// Fill with white background
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, outputWidth, outputHeight);

	// Scale context
	ctx.scale(scale, scale);

	// Render shapes
	for (const shape of renderShapes) {
		await renderShapeToCanvas(ctx, shape, bounds.x, bounds.y);
	}

	// Draw lasso overlay if needed
	if (drawLasso && lassoPoints) {
		drawLassoOverlay(ctx, lassoPoints, bounds.x, bounds.y);
	}

	// Convert to data URL
	const dataUrl = canvas.toDataURL("image/png");

	return {
		dataUrl,
		width: outputWidth,
		height: outputHeight,
		description,
	};
}
