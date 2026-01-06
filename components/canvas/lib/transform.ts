/**
 * Shape transformation utilities (move, resize, scale)
 */

import type { CanvasShape, PathShape } from "../types";
import { boundingBox, translatePoints, type Point, type Rect } from "./geometry";

export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * Move a shape by a delta, returning a new shape
 */
export function moveShape(shape: CanvasShape, dx: number, dy: number): CanvasShape {
	switch (shape.type) {
		case "line":
			return {
				...shape,
				x: shape.x + dx,
				y: shape.y + dy,
				x2: shape.x2 + dx,
				y2: shape.y2 + dy,
			};

		case "path":
			return {
				...shape,
				points: translatePoints(shape.points, dx, dy),
			};

		default:
			// All other shapes have simple x, y coordinates
			return {
				...shape,
				x: shape.x + dx,
				y: shape.y + dy,
			} as CanvasShape;
	}
}

/**
 * Calculate aspect-ratio-constrained dimensions
 */
export function constrainToAspectRatio(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	aspectRatio: number,
	corner: Corner
): { x1: number; y1: number; x2: number; y2: number } {
	const newWidth = Math.abs(x2 - x1);
	const newHeight = Math.abs(y2 - y1);
	const widthFromHeight = newHeight * aspectRatio;
	const heightFromWidth = newWidth / aspectRatio;

	let adjustedX1 = x1;
	let adjustedY1 = y1;
	let adjustedX2 = x2;
	let adjustedY2 = y2;

	if (widthFromHeight > newWidth) {
		// Height is the constraining dimension
		const adjustedWidth = widthFromHeight;
		if (corner === "nw" || corner === "sw") {
			adjustedX1 = x2 - (x1 < x2 ? adjustedWidth : -adjustedWidth);
		} else {
			adjustedX2 = x1 + (x2 > x1 ? adjustedWidth : -adjustedWidth);
		}
	} else {
		// Width is the constraining dimension
		const adjustedHeight = heightFromWidth;
		if (corner === "nw" || corner === "ne") {
			adjustedY1 = y2 - (y1 < y2 ? adjustedHeight : -adjustedHeight);
		} else {
			adjustedY2 = y1 + (y2 > y1 ? adjustedHeight : -adjustedHeight);
		}
	}

	return { x1: adjustedX1, y1: adjustedY1, x2: adjustedX2, y2: adjustedY2 };
}

/**
 * Apply corner resize to a bounding box
 */
export function applyCornerResize(
	bounds: Rect,
	corner: Corner,
	targetX: number,
	targetY: number
): { x1: number; y1: number; x2: number; y2: number } {
	let x1 = bounds.x;
	let y1 = bounds.y;
	let x2 = bounds.x + bounds.width;
	let y2 = bounds.y + bounds.height;

	switch (corner) {
		case "nw":
			x1 = targetX;
			y1 = targetY;
			break;
		case "ne":
			x2 = targetX;
			y1 = targetY;
			break;
		case "sw":
			x1 = targetX;
			y2 = targetY;
			break;
		case "se":
			x2 = targetX;
			y2 = targetY;
			break;
	}

	return { x1, y1, x2, y2 };
}

/**
 * Resize a rect-like shape (rect, ellipse, image, svg)
 */
export function resizeRectShape<T extends CanvasShape & { width: number; height: number }>(
	shape: T,
	originalBounds: Rect,
	corner: Corner,
	targetX: number,
	targetY: number,
	preserveAspectRatio: boolean
): T {
	const aspectRatio = originalBounds.width / (originalBounds.height || 1);

	let { x1, y1, x2, y2 } = applyCornerResize(originalBounds, corner, targetX, targetY);

	if (preserveAspectRatio) {
		({ x1, y1, x2, y2 } = constrainToAspectRatio(x1, y1, x2, y2, aspectRatio, corner));
	}

	return {
		...shape,
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1),
	};
}

/**
 * Scale points from one bounding box to another
 */
export function scalePoints(
	points: Point[],
	fromBounds: Rect,
	toBounds: Rect
): Point[] {
	const scaleX = (toBounds.width || 1) / (fromBounds.width || 1);
	const scaleY = (toBounds.height || 1) / (fromBounds.height || 1);

	return points.map((p) => ({
		x: toBounds.x + (p.x - fromBounds.x) * scaleX,
		y: toBounds.y + (p.y - fromBounds.y) * scaleY,
	}));
}

/**
 * Resize a path shape by scaling all points
 */
export function resizePathShape(
	shape: PathShape,
	originalPoints: Point[],
	corner: Corner,
	targetX: number,
	targetY: number,
	preserveAspectRatio: boolean
): PathShape {
	if (originalPoints.length === 0) return shape;

	const originalBounds = boundingBox(originalPoints);
	const aspectRatio = (originalBounds.width || 1) / (originalBounds.height || 1);

	let { x1, y1, x2, y2 } = applyCornerResize(originalBounds, corner, targetX, targetY);

	if (preserveAspectRatio) {
		({ x1, y1, x2, y2 } = constrainToAspectRatio(x1, y1, x2, y2, aspectRatio, corner));
	}

	const newBounds: Rect = {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x2 - x1) || 1,
		height: Math.abs(y2 - y1) || 1,
	};

	return {
		...shape,
		points: scalePoints(originalPoints, originalBounds, newBounds),
	};
}
