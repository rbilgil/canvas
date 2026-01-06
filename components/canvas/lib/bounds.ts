/**
 * Shape bounding box calculations
 */

import type { CanvasShape } from "../types";
import { boundingBox, type Rect } from "./geometry";

/**
 * Calculate the bounding box for any canvas shape
 */
export function getShapeBounds(shape: CanvasShape): Rect {
	switch (shape.type) {
		case "rect":
		case "ellipse":
		case "image":
		case "svg":
			return {
				x: shape.x,
				y: shape.y,
				width: shape.width,
				height: shape.height,
			};

		case "line": {
			const x = Math.min(shape.x, shape.x2);
			const y = Math.min(shape.y, shape.y2);
			return {
				x,
				y,
				width: Math.abs(shape.x2 - shape.x),
				height: Math.abs(shape.y2 - shape.y),
			};
		}

		case "text": {
			// Approximate text bounds based on character count and font size
			const width = Math.max(40, (shape.text.length || 1) * (shape.fontSize * 0.6));
			const height = shape.fontSize * 1.4;
			return { x: shape.x, y: shape.y, width, height };
		}

		case "path": {
			if (shape.points.length === 0) {
				return { x: 0, y: 0, width: 0, height: 0 };
			}
			return boundingBox(shape.points);
		}

		default:
			// Fallback for unknown shapes
			return {
				x: (shape as { x?: number }).x ?? 0,
				y: (shape as { y?: number }).y ?? 0,
				width: 0,
				height: 0,
			};
	}
}

/**
 * Calculate the combined bounding box for multiple shapes
 */
export function getCombinedBounds(shapes: CanvasShape[]): Rect {
	if (shapes.length === 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const bounds = shapes.map(getShapeBounds);
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
