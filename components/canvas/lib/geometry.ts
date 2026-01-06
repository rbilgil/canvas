/**
 * Geometry utilities for canvas operations
 */

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Calculate the distance between two points
 */
export function distance(p1: Point, p2: Point): number {
	return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Calculate the Manhattan distance between two points
 */
export function manhattanDistance(p1: Point, p2: Point): number {
	return Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
}

/**
 * Check if two rectangles intersect
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
	return (
		a.x <= b.x + b.width &&
		a.x + a.width >= b.x &&
		a.y <= b.y + b.height &&
		a.y + a.height >= b.y
	);
}

/**
 * Normalize a rectangle to ensure positive width/height
 */
export function normalizeRect(rect: Rect): Rect {
	return {
		x: Math.min(rect.x, rect.x + rect.width),
		y: Math.min(rect.y, rect.y + rect.height),
		width: Math.abs(rect.width),
		height: Math.abs(rect.height),
	};
}

/**
 * Get the center point of a rectangle
 */
export function rectCenter(rect: Rect): Point {
	return {
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2,
	};
}

/**
 * Calculate the centroid of a set of points
 */
export function centroid(points: Point[]): Point {
	if (points.length === 0) return { x: 0, y: 0 };
	const sum = points.reduce(
		(acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
		{ x: 0, y: 0 }
	);
	return {
		x: sum.x / points.length,
		y: sum.y / points.length,
	};
}

/**
 * Translate a point by a delta
 */
export function translatePoint(point: Point, dx: number, dy: number): Point {
	return { x: point.x + dx, y: point.y + dy };
}

/**
 * Translate an array of points by a delta
 */
export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
	return points.map((p) => translatePoint(p, dx, dy));
}

/**
 * Calculate bounding box from a set of points
 */
export function boundingBox(points: Point[]): Rect {
	if (points.length === 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/**
 * Expand a rectangle by a padding amount on all sides
 */
export function expandRect(rect: Rect, padding: number): Rect {
	return {
		x: rect.x - padding,
		y: rect.y - padding,
		width: rect.width + padding * 2,
		height: rect.height + padding * 2,
	};
}
