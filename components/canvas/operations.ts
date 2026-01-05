/**
 * CRDT Operations for Canvas
 * 
 * Operations are atomic changes that can be:
 * - Applied to reconstruct state
 * - Inverted for undo
 * - Sent to server for persistence
 * - Received from server for collaboration
 */

import type { CanvasShape } from "./types";

// Unique identifier for each operation
export type OperationId = string;

// Generate a unique operation ID
export function generateOperationId(): OperationId {
	return `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Base operation structure
interface BaseOperation {
	id: OperationId;
	timestamp: number;
	clientId: string;
}

// Add a new shape
export interface AddShapeOperation extends BaseOperation {
	type: "addShape";
	shape: CanvasShape;
}

// Update specific properties of a shape
export interface UpdateShapeOperation extends BaseOperation {
	type: "updateShape";
	shapeId: string;
	updates: Partial<CanvasShape>;
	previousValues: Partial<CanvasShape>; // For undo
}

// Delete a shape
export interface DeleteShapeOperation extends BaseOperation {
	type: "deleteShape";
	shapeId: string;
	deletedShape: CanvasShape; // For undo
}

// Union of all operation types
export type CanvasOperation =
	| AddShapeOperation
	| UpdateShapeOperation
	| DeleteShapeOperation;

// Create an addShape operation
export function createAddShapeOp(
	clientId: string,
	shape: CanvasShape,
): AddShapeOperation {
	return {
		id: generateOperationId(),
		type: "addShape",
		timestamp: Date.now(),
		clientId,
		shape,
	};
}

// Create an updateShape operation
export function createUpdateShapeOp(
	clientId: string,
	shapeId: string,
	updates: Partial<CanvasShape>,
	previousValues: Partial<CanvasShape>,
): UpdateShapeOperation {
	return {
		id: generateOperationId(),
		type: "updateShape",
		timestamp: Date.now(),
		clientId,
		shapeId,
		updates,
		previousValues,
	};
}

// Create a deleteShape operation
export function createDeleteShapeOp(
	clientId: string,
	deletedShape: CanvasShape,
): DeleteShapeOperation {
	return {
		id: generateOperationId(),
		type: "deleteShape",
		timestamp: Date.now(),
		clientId,
		shapeId: deletedShape.id,
		deletedShape,
	};
}

// Create the inverse of an operation (for undo)
export function invertOperation(
	clientId: string,
	op: CanvasOperation,
): CanvasOperation {
	switch (op.type) {
		case "addShape":
			// Inverse of add is delete
			return createDeleteShapeOp(clientId, op.shape);

		case "deleteShape":
			// Inverse of delete is add
			return createAddShapeOp(clientId, op.deletedShape);

		case "updateShape":
			// Inverse of update is update with previous values
			return createUpdateShapeOp(
				clientId,
				op.shapeId,
				op.previousValues,
				op.updates,
			);
	}
}

// Apply a single operation to shapes array
export function applyOperation(
	shapes: CanvasShape[],
	op: CanvasOperation,
): CanvasShape[] {
	switch (op.type) {
		case "addShape":
			// Check if shape already exists (idempotent)
			if (shapes.find((s) => s.id === op.shape.id)) {
				return shapes;
			}
			return [...shapes, op.shape];

		case "deleteShape":
			return shapes.filter((s) => s.id !== op.shapeId);

		case "updateShape": {
			const exists = shapes.find((s) => s.id === op.shapeId);
			if (!exists) {
				return shapes;
			}
			return shapes.map((s) =>
				s.id === op.shapeId ? ({ ...s, ...op.updates } as CanvasShape) : s,
			);
		}
	}
}

// Apply multiple operations to shapes array
export function applyOperations(
	shapes: CanvasShape[],
	ops: CanvasOperation[],
): CanvasShape[] {
	return ops.reduce((acc, op) => applyOperation(acc, op), shapes);
}

// Extract the properties that changed between two shapes
export function getShapeChanges(
	before: CanvasShape,
	after: CanvasShape,
): { updates: Partial<CanvasShape>; previousValues: Partial<CanvasShape> } {
	const updates: Partial<CanvasShape> = {};
	const previousValues: Partial<CanvasShape> = {};

	const allKeys = new Set([
		...Object.keys(before),
		...Object.keys(after),
	]) as Set<keyof CanvasShape>;

	for (const key of allKeys) {
		const beforeVal = before[key];
		const afterVal = after[key];
		if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
			// @ts-expect-error - dynamic property assignment
			updates[key] = afterVal;
			// @ts-expect-error - dynamic property assignment
			previousValues[key] = beforeVal;
		}
	}

	return { updates, previousValues };
}

// Serialization helpers for Convex storage
export function serializeOperation(op: CanvasOperation): string {
	return JSON.stringify(op);
}

export function deserializeOperation(data: string): CanvasOperation {
	return JSON.parse(data) as CanvasOperation;
}

// Batch operations into a single operation for efficiency
// (useful when user does rapid updates like dragging)
export interface BatchOperation extends BaseOperation {
	type: "batch";
	operations: CanvasOperation[];
}

export function createBatchOp(
	clientId: string,
	operations: CanvasOperation[],
): BatchOperation {
	return {
		id: generateOperationId(),
		type: "batch",
		timestamp: Date.now(),
		clientId,
		operations,
	};
}

