"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Type for the designOperations API (will be generated after running convex dev)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const designOpsApi = (api as any).designOperations as {
	applyOperations: typeof api.designs.updateDesignConfig;
	getOperationsSince: typeof api.designs.getDesignsByProject;
};
import {
	type CanvasOperation,
	applyOperations,
	createAddShapeOp,
	createDeleteShapeOp,
	createUpdateShapeOp,
	deserializeOperation,
	getShapeChanges,
	invertOperation,
	serializeOperation,
} from "./operations";
import type { CanvasShape } from "./types";

// Generate a unique client ID for this session
function generateClientId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface UseCanvasOperationsOptions {
	designId: Id<"designs"> | null;
	initialShapes: CanvasShape[];
}

export interface UseCanvasOperationsResult {
	shapes: CanvasShape[];
	addShape: (shape: CanvasShape) => void;
	updateShape: (shapeId: string, updates: Partial<CanvasShape>) => void;
	deleteShape: (shapeId: string) => void;
	deleteShapes: (shapeIds: string[]) => void;
	undo: () => boolean;
	canUndo: boolean;
	isConnected: boolean;
}

export function useCanvasOperations({
	designId,
	initialShapes,
}: UseCanvasOperationsOptions): UseCanvasOperationsResult {
	// Client ID is stable for this session
	const clientIdRef = useRef<string>(generateClientId());

	// Local shapes state
	const [shapes, setShapes] = useState<CanvasShape[]>(initialShapes);

	// Operation stack for undo (stores the inverse operations)
	const [undoStack, setUndoStack] = useState<CanvasOperation[]>([]);

	// Track the last server timestamp we've processed
	const lastServerTimestampRef = useRef<number>(0);

	// Pending operations waiting to be sent to server
	const pendingOpsRef = useRef<CanvasOperation[]>([]);
	const flushTimeoutRef = useRef<number | null>(null);

	// Track if we've initialized for this design
	const initializedForDesignRef = useRef<string | null>(null);

	// Convex mutations - using type assertion until types are regenerated
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const applyOpsMutation = useMutation(designOpsApi.applyOperations as any);

	// Subscribe to remote operations
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const remoteOps = useQuery(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		designOpsApi.getOperationsSince as any,
		designId
			? {
					designId,
					sinceTimestamp: lastServerTimestampRef.current,
					excludeClientId: clientIdRef.current,
				}
			: "skip",
	);

	// Initialize shapes when design changes
	useEffect(() => {
		if (designId && initializedForDesignRef.current !== designId) {
			setShapes(initialShapes);
			setUndoStack([]);
			lastServerTimestampRef.current = 0;
			initializedForDesignRef.current = designId;
		}
	}, [designId, initialShapes]);

	// Apply remote operations when they arrive
	useEffect(() => {
		if (!remoteOps || remoteOps.length === 0) return;

		const newOps = remoteOps.map((op: { operation: string }) => 
			deserializeOperation(op.operation)
		);

		setShapes((prev) => applyOperations(prev, newOps));

		// Update the last processed timestamp
		const maxTimestamp = Math.max(
			...remoteOps.map((op: { serverTimestamp: number }) => op.serverTimestamp)
		);
		if (maxTimestamp > lastServerTimestampRef.current) {
			lastServerTimestampRef.current = maxTimestamp;
		}
	}, [remoteOps]);

	// Flush pending operations to server
	const flushPendingOps = useCallback(async () => {
		if (!designId || pendingOpsRef.current.length === 0) return;

		const opsToSend = pendingOpsRef.current;
		pendingOpsRef.current = [];

		try {
			const result = await applyOpsMutation({
				designId,
				clientId: clientIdRef.current,
				operations: opsToSend.map((op) => ({
					operationId: op.id,
					operation: serializeOperation(op),
					timestamp: op.timestamp,
				})),
			});

			// Update our timestamp to avoid reprocessing our own ops
			if (result.serverTimestamp > lastServerTimestampRef.current) {
				lastServerTimestampRef.current = result.serverTimestamp;
			}
		} catch (error) {
			console.error("Failed to apply operations:", error);
			// Re-queue the operations for retry
			pendingOpsRef.current = [...opsToSend, ...pendingOpsRef.current];
		}
	}, [designId, applyOpsMutation]);

	// Schedule a flush of pending operations
	const scheduleFlush = useCallback(() => {
		if (flushTimeoutRef.current) {
			clearTimeout(flushTimeoutRef.current);
		}
		// Debounce: wait 100ms before flushing
		flushTimeoutRef.current = window.setTimeout(() => {
			void flushPendingOps();
			flushTimeoutRef.current = null;
		}, 100);
	}, [flushPendingOps]);

	// Apply an operation locally and queue for server
	const applyLocalOperation = useCallback(
		(op: CanvasOperation, pushToUndo = true) => {
			// Apply locally (instant)
			setShapes((prev) => applyOperations(prev, [op]));

			// Add inverse to undo stack
			if (pushToUndo) {
				const inverse = invertOperation(clientIdRef.current, op);
				setUndoStack((prev) => [...prev, inverse]);
			}

			// Queue for server
			pendingOpsRef.current.push(op);
			scheduleFlush();
		},
		[scheduleFlush],
	);

	// Add a new shape
	const addShape = useCallback(
		(shape: CanvasShape) => {
			const op = createAddShapeOp(clientIdRef.current, shape);
			applyLocalOperation(op);
		},
		[applyLocalOperation],
	);

	// Update a shape
	const updateShape = useCallback(
		(shapeId: string, updates: Partial<CanvasShape>) => {
			// Find the current shape to get previous values
			const currentShape = shapes.find((s) => s.id === shapeId);
			if (!currentShape) return;

			const { updates: actualUpdates, previousValues } = getShapeChanges(
				currentShape,
				{ ...currentShape, ...updates } as CanvasShape,
			);

			// Only create operation if something actually changed
			if (Object.keys(actualUpdates).length === 0) return;

			const op = createUpdateShapeOp(
				clientIdRef.current,
				shapeId,
				actualUpdates,
				previousValues,
			);
			applyLocalOperation(op);
		},
		[shapes, applyLocalOperation],
	);

	// Delete a shape
	const deleteShape = useCallback(
		(shapeId: string) => {
			const shape = shapes.find((s) => s.id === shapeId);
			if (!shape) return;

			const op = createDeleteShapeOp(clientIdRef.current, shape);
			applyLocalOperation(op);
		},
		[shapes, applyLocalOperation],
	);

	// Delete multiple shapes
	const deleteShapes = useCallback(
		(shapeIds: string[]) => {
			for (const shapeId of shapeIds) {
				const shape = shapes.find((s) => s.id === shapeId);
				if (shape) {
					const op = createDeleteShapeOp(clientIdRef.current, shape);
					applyLocalOperation(op);
				}
			}
		},
		[shapes, applyLocalOperation],
	);

	// Undo the last operation
	const undo = useCallback((): boolean => {
		if (undoStack.length === 0) return false;

		const inverseOp = undoStack[undoStack.length - 1];
		setUndoStack((prev) => prev.slice(0, -1));

		// Apply the inverse operation (don't push to undo stack)
		// Apply locally
		setShapes((prev) => applyOperations(prev, [inverseOp]));

		// Queue for server
		pendingOpsRef.current.push(inverseOp);
		scheduleFlush();

		return true;
	}, [undoStack, scheduleFlush]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (flushTimeoutRef.current) {
				clearTimeout(flushTimeoutRef.current);
			}
			// Final flush
			void flushPendingOps();
		};
	}, [flushPendingOps]);

	return {
		shapes,
		addShape,
		updateShape,
		deleteShape,
		deleteShapes,
		undo,
		canUndo: undoStack.length > 0,
		isConnected: remoteOps !== undefined,
	};
}

