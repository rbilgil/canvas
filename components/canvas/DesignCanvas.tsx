"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { runLassoEdit as externalRunLassoEdit } from "@/components/canvas/imageLasso";
import {
	applyZOrder,
	buildCombineSelectionPrompt,
	type Corner,
	calculateShapesBounds,
	centroid,
	computeEditShapeUpdates,
	computeEditTextUpdates,
	createImageShapeFromResult,
	getShapeBounds,
	getShapesForIds,
	isAsyncCommand,
	isZOrderCommand,
	moveShape,
	normalizeRect,
	rectsIntersect,
	resizePathShape,
	resizeRectShape,
	resolveSelectionIds,
	SHAPE_DEFAULTS,
	SIZES,
	shapeFromCommand,
} from "@/components/canvas/lib";
import {
	applyOperations,
	type CanvasOperation,
	createAddShapeOp,
	createDeleteShapeOp,
	createUpdateShapeOp,
	getShapeChanges,
	invertOperation,
	safeDeserializeOperation,
	serializeOperation,
} from "@/components/canvas/operations";
import { PropertiesPanel } from "@/components/canvas/PropertiesPanel";
import { renderCanvasContext } from "@/components/canvas/renderContext";
import { ShapeView } from "@/components/canvas/ShapeView";
import {
	createEllipse,
	createLine,
	createRect,
	createText,
} from "@/components/canvas/shapeFactories";
import type {
	AnyCommand,
	CanvasShape,
	CanvasToolCommand,
	ImageShape,
	PathShape,
	Tool,
} from "@/components/canvas/types";
import {
	clientToSvg,
	createShapeId,
	readImageFile,
	svgToClient,
} from "@/components/canvas/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Type definitions for the designOperations API
// These match the actual mutations/queries in convex/designOperations.ts
interface ApplyOperationsResult {
	success: boolean;
	lastCreationTime: number;
	appliedCount: number;
}

interface RemoteOperation {
	operationId: string;
	operation: string;
	clientId: string;
	clientTimestamp: number;
	creationTime: number;
}

// Access the designOperations API (types are manually defined until regenerated)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const designOpsApi = (api as any).designOperations as {
	applyOperations: (args: {
		designId: Id<"designs">;
		clientId: string;
		operations: Array<{
			operationId: string;
			operation: string;
			timestamp: number;
		}>;
	}) => Promise<ApplyOperationsResult>;
	getOperationsSince: (args: {
		designId: Id<"designs">;
		sinceCreationTime: number;
		excludeClientId?: string;
	}) => RemoteOperation[];
};

// Context-aware placeholder examples for the right-click prompt
const PLACEHOLDER_EXAMPLES = {
	// No selection - general canvas operations
	none: [
		"add a red circle",
		"create text saying Hello",
		"generate image of a sunset",
		"draw a rectangle here",
		"add a blue square",
		"create a line across",
	],
	// Shape selected (rect, ellipse, line, path)
	shape: [
		"paint it yellow",
		"make it 20% bigger",
		"move to the left",
		"bring to front",
		"change the color to blue",
		"make it smaller",
	],
	// Text selected
	text: [
		"make the font bigger",
		"add a shadow effect",
		"change to bold",
		"paint it red",
		"increase font size",
		"add text outline",
	],
	// Image selected
	image: [
		"make it brighter",
		"remove the background",
		"make it 20% smaller",
		"move to center",
		"bring to front",
		"add a blur effect",
	],
	// Multiple shapes selected
	multiple: [
		"combine into one scene",
		"align them horizontally",
		"paint them all blue",
		"move closer together",
		"bring to front",
		"make them all bigger",
	],
};

function getRandomPlaceholder(
	category: keyof typeof PLACEHOLDER_EXAMPLES,
): string {
	const examples = PLACEHOLDER_EXAMPLES[category];
	return examples[Math.floor(Math.random() * examples.length)];
}

export interface DesignData {
	id: string;
	name: string;
	width: number;
	height: number;
	initialShapes: CanvasShape[];
}

export interface DesignCanvasProps {
	designs: DesignData[];
	activeDesignId: string | null;
	onActivate: (designId: string) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	onUndoStackChange?: (designId: string, canUndo: boolean) => void;
	/** Callback when selection changes */
	onSelectionChange?: (hasSelection: boolean) => void;
}

export interface DesignCanvasRef {
	getShapes: (designId: string) => CanvasShape[];
	undo: () => void;
	resetView: () => void;
	canUndo: () => boolean;
	hasSelection: () => boolean;
	moveSelectionUp: () => void;
	moveSelectionDown: () => void;
	deleteSelection: () => void;
}

// Generate a unique client ID for this session
function generateClientId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Internal component for a single design canvas
interface SingleDesignCanvasProps {
	design: DesignData;
	isActive: boolean;
	onActivate: (designId: string) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	clientId: string;
	onCanUndoChange?: (designId: string, canUndo: boolean) => void;
	registerUndo?: (designId: string, undoFn: () => boolean) => void;
	onSelectionChange?: (hasSelection: boolean) => void;
	/** Register layer operations for this design */
	registerLayerOps?: (
		designId: string,
		ops: {
			moveUp: () => void;
			moveDown: () => void;
			deleteSelection: () => void;
			hasSelection: () => boolean;
		},
	) => void;
}

function SingleDesignCanvas({
	design,
	isActive,
	onActivate,
	tool,
	onToolChange,
	clientId,
	onCanUndoChange,
	registerUndo,
	onSelectionChange,
	registerLayerOps,
}: SingleDesignCanvasProps) {
	// Local shapes state for immediate UI feedback
	const [shapes, setShapes] = useState<CanvasShape[]>(design.initialShapes);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Array<string>>([]);
	const [isPointerDown, setIsPointerDown] = useState(false);
	const [draftId, setDraftId] = useState<string | null>(null);
	const [pencilDraftId, setPencilDraftId] = useState<string | null>(null);
	const [activeHandle, setActiveHandle] = useState<
		| null
		| { kind: "corner"; corner: "nw" | "ne" | "sw" | "se" }
		| { kind: "line-end"; end: 1 | 2 }
	>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const groupDragRef = useRef<null | {
		startX: number;
		startY: number;
		originals: Record<string, CanvasShape>;
	}>(null);

	// Track interaction state for operation creation
	const interactionOriginalRef = useRef<CanvasShape | null>(null);
	const createdShapeIdRef = useRef<string | null>(null);
	// Track if we're extending an existing path (vs creating new)
	const extendingPathRef = useRef<PathShape | null>(null);

	// Operation-based undo stack
	const [undoStack, setUndoStack] = useState<CanvasOperation[]>([]);

	// Track which design we've initialized
	const initializedForDesignRef = useRef<string | null>(null);

	// Pending operations to send to server
	const pendingOpsRef = useRef<CanvasOperation[]>([]);
	const flushTimeoutRef = useRef<number | null>(null);
	// Track last seen _creationTime for sync (following Convex+Automerge pattern)
	// Using state (not ref) so useQuery re-runs when this changes
	const [lastCreationTime, setLastCreationTime] = useState<number>(0);

	// Convex mutations - using type assertion until types are regenerated
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const applyOpsMutation = useMutation(designOpsApi.applyOperations as any);
	// For z-order persistence (direct config update)
	const updateDesignConfig = useMutation(api.designs.updateDesignConfig);

	// Subscribe to remote operations (from other clients)
	// Using _creationTime for ordering as recommended by:
	// https://stack.convex.dev/automerge-and-convex
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const remoteOps = useQuery(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		designOpsApi.getOperationsSince as any,
		design.id
			? {
					designId: design.id as Id<"designs">,
					sinceCreationTime: lastCreationTime,
					excludeClientId: clientId,
				}
			: "skip",
	);

	// Text editing overlay state
	const [editingTextId, setEditingTextId] = useState<string | null>(null);
	const [textEditorValue, setTextEditorValue] = useState<string>("");
	const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
	const [textEditorPos, setTextEditorPos] = useState<{
		left: number;
		top: number;
		fontSize: number;
	}>({ left: 0, top: 0, fontSize: 16 });

	// Right-click command palette state
	const [rcOpen, setRcOpen] = useState(false);
	const [rcText, setRcText] = useState("");
	const [rcPos, setRcPos] = useState<{ left: number; top: number }>({
		left: 0,
		top: 0,
	});
	const [rcBusy, setRcBusy] = useState(false);
	const [rcPlaceholder, setRcPlaceholder] = useState("paint it yellow");
	// Smart suggestions state
	const [rcSuggestions, setRcSuggestions] = useState<
		Array<{ label: string; command: CanvasToolCommand }>
	>([]);
	const [rcSuggestionsLoading, setRcSuggestionsLoading] = useState(false);

	const interpret = useAction(api.canvas_ai.interpret);
	const suggestActions = useAction(api.canvas_ai.suggestActions);
	const generateCanvasImage = useAction(api.images.generateCanvasImage);
	const editCanvasImage = useAction(api.images.editCanvasImage);
	const uploadImage = useAction(api.images.uploadImage);

	// Loading state for async operations (image generation, etc.)
	const [isProcessing, setIsProcessing] = useState(false);

	// Lasso tool state
	const [isLassoing, setIsLassoing] = useState(false);
	const [lassoPoints, setLassoPoints] = useState<
		Array<{ x: number; y: number }>
	>([]);
	const [lassoImageId, setLassoImageId] = useState<string | null>(null);
	const [lassoPending, setLassoPending] = useState<null | {
		imageId: string | null; // null means general context, string means image-specific edit
		points: Array<{ x: number; y: number }>;
	}>(null);

	// Marquee selection
	const [marquee, setMarquee] = useState<null | {
		x: number;
		y: number;
		width: number;
		height: number;
	}>(null);

	// Track applied operation IDs to prevent duplicate application
	const appliedOpIdsRef = useRef<Set<string>>(new Set());

	// Initialize shapes when design changes
	useEffect(() => {
		if (initializedForDesignRef.current !== design.id) {
			setShapes(design.initialShapes);
			setUndoStack([]);
			setLastCreationTime(0);
			appliedOpIdsRef.current.clear();
			initializedForDesignRef.current = design.id;
		}
	}, [design.id, design.initialShapes]);

	// Apply remote operations when they arrive
	// Following the sync pattern from: https://stack.convex.dev/automerge-and-convex
	useEffect(() => {
		if (!remoteOps || remoteOps.length === 0) return;

		// Filter out operations we've already applied (deduplication)
		// and validate incoming operations
		const newOps: CanvasOperation[] = [];
		let maxCreationTime = lastCreationTime;

		for (const op of remoteOps as Array<{
			operationId: string;
			operation: string;
			creationTime: number;
		}>) {
			if (!appliedOpIdsRef.current.has(op.operationId)) {
				// Use safe deserialization to gracefully handle corrupted data
				const deserializedOp = safeDeserializeOperation(op.operation);
				if (deserializedOp) {
					newOps.push(deserializedOp);
					appliedOpIdsRef.current.add(op.operationId);
				}
				// If null, the operation was invalid - skip it but still track the ID
				// to avoid re-processing
				else {
					appliedOpIdsRef.current.add(op.operationId);
				}
			}
			maxCreationTime = Math.max(maxCreationTime, op.creationTime);
		}

		if (newOps.length > 0) {
			setShapes((prev) => applyOperations(prev, newOps));
		}

		// Update the last seen _creationTime
		if (maxCreationTime > lastCreationTime) {
			setLastCreationTime(maxCreationTime);
		}
	}, [remoteOps, lastCreationTime]);

	// Notify parent of undo stack changes
	useEffect(() => {
		onCanUndoChange?.(design.id, undoStack.length > 0);
	}, [design.id, undoStack.length, onCanUndoChange]);

	// Flush pending operations to server
	// Following the sync pattern from: https://stack.convex.dev/automerge-and-convex
	const flushPendingOps = useCallback(async () => {
		if (!design.id || pendingOpsRef.current.length === 0) return;

		const opsToSend = pendingOpsRef.current;
		pendingOpsRef.current = [];

		// Mark these operation IDs as applied so we don't re-apply from subscription
		for (const op of opsToSend) {
			appliedOpIdsRef.current.add(op.id);
		}

		try {
			const result = await applyOpsMutation({
				designId: design.id as Id<"designs">,
				clientId,
				operations: opsToSend.map((op) => ({
					operationId: op.id,
					operation: serializeOperation(op),
					timestamp: op.timestamp,
				})),
			});

			// Update our _creationTime cursor to avoid reprocessing our own ops
			// The server returns the lastCreationTime from the inserted documents
			setLastCreationTime((prev) =>
				Math.max(prev, result.lastCreationTime ?? 0),
			);
		} catch (error) {
			console.error("Failed to apply operations:", error);
			// Re-queue the operations for retry (idempotency ensures safety)
			pendingOpsRef.current = [...opsToSend, ...pendingOpsRef.current];
		}
	}, [design.id, clientId, applyOpsMutation]);

	// Schedule a flush of pending operations
	const scheduleFlush = useCallback(() => {
		if (flushTimeoutRef.current) {
			clearTimeout(flushTimeoutRef.current);
		}
		// Debounce: wait 50ms before flushing (fast enough to feel instant)
		flushTimeoutRef.current = window.setTimeout(() => {
			void flushPendingOps();
			flushTimeoutRef.current = null;
		}, 50);
	}, [flushPendingOps]);

	// Apply an operation locally and queue for server
	const applyOperation = useCallback(
		(op: CanvasOperation, pushToUndo = true) => {
			// Apply locally (instant)
			setShapes((prev) => applyOperations(prev, [op]));

			// Add inverse to undo stack
			if (pushToUndo) {
				const inverse = invertOperation(clientId, op);
				setUndoStack((prev) => [...prev, inverse]);
			}

			// Queue for server
			pendingOpsRef.current.push(op);
			scheduleFlush();
		},
		[clientId, scheduleFlush],
	);

	// Operation-based shape manipulation methods
	const addShapeOp = useCallback(
		(shape: CanvasShape) => {
			const op = createAddShapeOp(clientId, shape);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	const updateShapeOp = useCallback(
		(
			shapeId: string,
			currentShape: CanvasShape,
			updates: Partial<CanvasShape>,
		) => {
			const { updates: actualUpdates, previousValues } = getShapeChanges(
				currentShape,
				{ ...currentShape, ...updates } as CanvasShape,
			);
			if (Object.keys(actualUpdates).length === 0) return;

			const op = createUpdateShapeOp(
				clientId,
				shapeId,
				actualUpdates,
				previousValues,
			);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	const deleteShapeOp = useCallback(
		(shape: CanvasShape) => {
			const op = createDeleteShapeOp(clientId, shape);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	// Layer operations - move shapes up/down in z-order
	// Note: shapes array order = z-order (last = on top)
	const moveSelectionUp = useCallback(() => {
		const ids =
			selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
		if (ids.length === 0) return;

		setShapes((prev) => {
			const newShapes = [...prev];
			// Process from end to start to avoid index shifting issues
			for (let i = newShapes.length - 2; i >= 0; i--) {
				if (
					ids.includes(newShapes[i].id) &&
					!ids.includes(newShapes[i + 1].id)
				) {
					// Swap with the shape above
					[newShapes[i], newShapes[i + 1]] = [newShapes[i + 1], newShapes[i]];
				}
			}
			// Persist z-order to backend
			void updateDesignConfig({
				designId: design.id as Id<"designs">,
				config: { shapes: newShapes },
			});
			return newShapes;
		});
	}, [selectedIds, selectedId, design.id, updateDesignConfig]);

	const moveSelectionDown = useCallback(() => {
		const ids =
			selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
		if (ids.length === 0) return;

		setShapes((prev) => {
			const newShapes = [...prev];
			// Process from start to end to avoid index shifting issues
			for (let i = 1; i < newShapes.length; i++) {
				if (
					ids.includes(newShapes[i].id) &&
					!ids.includes(newShapes[i - 1].id)
				) {
					// Swap with the shape below
					[newShapes[i], newShapes[i - 1]] = [newShapes[i - 1], newShapes[i]];
				}
			}
			// Persist z-order to backend
			void updateDesignConfig({
				designId: design.id as Id<"designs">,
				config: { shapes: newShapes },
			});
			return newShapes;
		});
	}, [selectedIds, selectedId, design.id, updateDesignConfig]);

	const deleteSelectionOp = useCallback(() => {
		const ids =
			selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
		if (ids.length === 0) return;

		for (const id of ids) {
			const shape = shapes.find((s) => s.id === id);
			if (shape) deleteShapeOp(shape);
		}
		setSelectedId(null);
		setSelectedIds([]);
	}, [selectedIds, selectedId, shapes, deleteShapeOp]);

	const hasSelection = useCallback(() => {
		return selectedIds.length > 0 || selectedId !== null;
	}, [selectedIds, selectedId]);

	// Notify parent of selection changes
	useEffect(() => {
		onSelectionChange?.(selectedIds.length > 0 || selectedId !== null);
	}, [selectedIds, selectedId, onSelectionChange]);

	// Register layer operations with parent
	useEffect(() => {
		registerLayerOps?.(design.id, {
			moveUp: moveSelectionUp,
			moveDown: moveSelectionDown,
			deleteSelection: deleteSelectionOp,
			hasSelection,
		});
	}, [
		design.id,
		moveSelectionUp,
		moveSelectionDown,
		deleteSelectionOp,
		hasSelection,
		registerLayerOps,
	]);

	// Undo the last operation
	const undo = useCallback((): boolean => {
		if (undoStack.length === 0) return false;

		const inverseOp = undoStack[undoStack.length - 1];
		setUndoStack((prev) => prev.slice(0, -1));

		// Apply the inverse operation (don't push to undo stack)
		setShapes((prev) => applyOperations(prev, [inverseOp]));

		// Queue for server
		pendingOpsRef.current.push(inverseOp);
		scheduleFlush();

		return true;
	}, [undoStack, scheduleFlush]);

	// For AI commands that need the old command system
	// Returns a promise that resolves when all async operations (image generation) are complete
	const applyCommandGroup = useCallback(
		async (
			commands: Array<AnyCommand>,
			_opts?: { recordUndo?: boolean },
			context?: { userPrompt: string; canvasDataUrl: string },
		): Promise<void> => {
			// Separate async (image) commands from synchronous ones
			const asyncCommands = commands.filter(
				(c) => "tool" in c && isAsyncCommand(c as CanvasToolCommand),
			) as Array<CanvasToolCommand>;
			const syncCommands = commands.filter(
				(c) => !("tool" in c) || !isAsyncCommand(c as CanvasToolCommand),
			);

			// Process synchronous commands
			for (const cmd of syncCommands) {
				// Local undo commands
				if (cmd.tool === "deleteObject" && "id" in cmd && cmd.id) {
					const shape = shapes.find((s) => s.id === cmd.id);
					if (shape) deleteShapeOp(shape);
					continue;
				}
				if (cmd.tool === "replaceShape" && "shape" in cmd) {
					const existingShape = shapes.find((s) => s.id === cmd.shape.id);
					if (existingShape) {
						updateShapeOp(cmd.shape.id, existingShape, cmd.shape);
					} else {
						addShapeOp(cmd.shape);
					}
					continue;
				}

				// Cast to CanvasToolCommand for the remaining handlers
				// (we've already handled local undo commands above)
				const toolCmd = cmd as CanvasToolCommand;

				// Shape editing
				if (toolCmd.tool === "editShape") {
					const targetId = toolCmd.id || toolCmd.target || selectedId;
					if (!targetId) continue;
					const shape = shapes.find((s) => s.id === targetId);
					if (!shape) continue;
					const updates = computeEditShapeUpdates(shape, toolCmd);
					if (updates) {
						updateShapeOp(targetId, shape, updates);
					}
					continue;
				}

				// Text editing
				if (toolCmd.tool === "editText") {
					const targetId = toolCmd.id || selectedId;
					if (!targetId) continue;
					const shape = shapes.find((s) => s.id === targetId);
					if (!shape || shape.type !== "text") continue;
					const updates = computeEditTextUpdates(shape, toolCmd);
					if (updates) {
						updateShapeOp(targetId, shape, updates);
					}
					continue;
				}

				// Shape creation commands
				const newShape = shapeFromCommand(toolCmd, {
					createId: createShapeId,
				});
				if (newShape) {
					addShapeOp(newShape);
					continue;
				}

				// Z-order commands
				if (isZOrderCommand(toolCmd)) {
					const targetId = toolCmd.id || selectedId;
					if (!targetId) continue;
					const reordered = applyZOrder(shapes, targetId, toolCmd.tool);
					if (reordered) {
						setShapes(reordered);
						void updateDesignConfig({
							designId: design.id as Id<"designs">,
							config: { shapes: reordered },
						});
					}
				}
			}

			// Process async (image) commands
			if (asyncCommands.length > 0) {
				setIsProcessing(true);
				try {
					for (const cmd of asyncCommands) {
						if (cmd.tool === "generateImage") {
							const prompt = cmd.prompt || "";
							const hasSelection = selectedIds.length > 0 || !!selectedId;
							const res = await generateCanvasImage({
								prompt,
								width: cmd.width,
								height: cmd.height,
								referenceImageUrl: hasSelection
									? context?.canvasDataUrl
									: undefined,
							});
							const newShape = createImageShapeFromResult(res, {
								id: cmd.id || createShapeId("img"),
								x: cmd.x ?? 40,
								y: cmd.y ?? 40,
							});
							addShapeOp(newShape);
						} else if (cmd.tool === "editImage") {
							const id = cmd.id || selectedId;
							if (!id || !cmd.prompt) continue;
							const before = shapes.find(
								(s): s is ImageShape => s.id === id && s.type === "image",
							);
							if (!before) continue;
							const res = await editCanvasImage({
								imageUrl: before.href,
								prompt: cmd.prompt,
							});
							updateShapeOp(before.id, before, { href: res.storageUrl });
						} else if (cmd.tool === "combineSelection") {
							if (!context?.userPrompt) {
								console.log("combineSelection: missing prompt");
								continue;
							}

							try {
								// Determine which shapes to render
								const idsToRender = resolveSelectionIds(
									selectedIds,
									selectedId,
								);
								const shapesToCombine = getShapesForIds(shapes, idsToRender);

								// Render the shapes to an image
								const renderContext = await renderCanvasContext({
									shapes,
									canvasWidth: design.width,
									canvasHeight: design.height,
									selectedIds: idsToRender,
								});

								// Calculate bounds to position the result
								const bounds =
									shapesToCombine.length > 0
										? calculateShapesBounds(shapesToCombine)
										: {
												x: 0,
												y: 0,
												width: design.width,
												height: design.height,
											};

								// Generate the combined image
								const result = await generateCanvasImage({
									prompt: buildCombineSelectionPrompt(context.userPrompt),
									referenceImageUrl: renderContext.dataUrl,
								});

								// Add the generated image as a new shape
								const id = createShapeId("img");
								const newShape = createImageShapeFromResult(result, {
									id,
									x: bounds.x,
									y: bounds.y,
								});
								addShapeOp(newShape);

								// Select the new image
								setSelectedId(id);
								setSelectedIds([id]);
							} catch (err) {
								console.error("combineSelection failed:", err);
							}
						}
					}
				} finally {
					setIsProcessing(false);
				}
			}
		},
		[
			selectedId,
			selectedIds,
			shapes,
			design.width,
			design.height,
			design.id,
			generateCanvasImage,
			editCanvasImage,
			addShapeOp,
			updateShapeOp,
			deleteShapeOp,
			updateDesignConfig,
			setShapes,
		],
	);

	// Keyboard shortcuts (only when active)
	useEffect(() => {
		if (!isActive) return;

		const onKey = (e: KeyboardEvent) => {
			// Ignore keyboard shortcuts when typing in an input field
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable
			) {
				return;
			}

			const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z";
			if (isUndo) {
				e.preventDefault();
				undo();
				return;
			}
			if (e.key === "Backspace" || e.key === "Delete") {
				if (selectedIds.length === 0 && !selectedId) return;
				e.preventDefault();
				const idsToDelete = selectedIds.length
					? selectedIds
					: selectedId
						? [selectedId]
						: [];
				for (const id of idsToDelete) {
					const shape = shapes.find((s) => s.id === id);
					if (shape) deleteShapeOp(shape);
				}
				setSelectedId(null);
				setSelectedIds([]);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [isActive, selectedId, selectedIds, shapes, undo, deleteShapeOp]);

	const selectedShape = useMemo(() => {
		if (selectedIds.length === 1) {
			const onlyId = selectedIds[0];
			return shapes.find((s) => s.id === onlyId) ?? null;
		}
		return null;
	}, [shapes, selectedIds]);

	// Local shape manipulation (for immediate UI feedback during gestures)
	const setShapeById = useCallback(
		(id: string, updater: (s: CanvasShape) => CanvasShape) => {
			setShapes((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
		},
		[],
	);

	const removeShapeById = useCallback((id: string) => {
		setShapes((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const svgPoint = (evt: React.PointerEvent): { x: number; y: number } => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		return clientToSvg(svg, evt.clientX, evt.clientY);
	};

	const svgPointFromScreen = (
		clientX: number,
		clientY: number,
	): { x: number; y: number } => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		return clientToSvg(svg, clientX, clientY);
	};

	const screenPointFromSvg = (
		x: number,
		y: number,
	): { left: number; top: number } => {
		const svg = svgRef.current;
		if (!svg) return { left: 0, top: 0 };
		return svgToClient(svg, x, y);
	};

	// Find a path shape near the given point (for continuing drawing)
	// Checks: 1) near any point on the path, 2) along line segments, 3) inside bounding box
	const findNearbyPath = (
		x: number,
		y: number,
		threshold: number = 15,
	): PathShape | null => {
		for (let i = shapes.length - 1; i >= 0; i--) {
			const shape = shapes[i];
			if (shape.type !== "path") continue;
			const path = shape as PathShape;
			if (path.points.length === 0) continue;

			// Check if near any point on the path
			for (const pt of path.points) {
				if (Math.hypot(x - pt.x, y - pt.y) <= threshold) {
					return path;
				}
			}

			// Check along line segments
			for (let j = 0; j < path.points.length - 1; j++) {
				const p1 = path.points[j];
				const p2 = path.points[j + 1];
				if (pointToSegmentDistance(x, y, p1, p2) <= threshold) {
					return path;
				}
			}

			// Check if inside bounding box (with padding) - for clicking inside shapes
			const bounds = getPathBounds(path.points);
			const padding = threshold;
			if (
				x >= bounds.minX - padding &&
				x <= bounds.maxX + padding &&
				y >= bounds.minY - padding &&
				y <= bounds.maxY + padding
			) {
				return path;
			}
		}
		return null;
	};

	// Helper: distance from point to line segment
	const pointToSegmentDistance = (
		px: number,
		py: number,
		p1: { x: number; y: number },
		p2: { x: number; y: number },
	): number => {
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const lenSq = dx * dx + dy * dy;
		if (lenSq === 0) return Math.hypot(px - p1.x, py - p1.y);
		let t = ((px - p1.x) * dx + (py - p1.y) * dy) / lenSq;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (p1.x + t * dx), py - (p1.y + t * dy));
	};

	// Helper: get bounding box of path points
	const getPathBounds = (
		points: Array<{ x: number; y: number }>,
	): { minX: number; minY: number; maxX: number; maxY: number } => {
		if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
		let minX = points[0].x,
			maxX = points[0].x;
		let minY = points[0].y,
			maxY = points[0].y;
		for (const pt of points) {
			minX = Math.min(minX, pt.x);
			maxX = Math.max(maxX, pt.x);
			minY = Math.min(minY, pt.y);
			maxY = Math.max(maxY, pt.y);
		}
		return { minX, minY, maxX, maxY };
	};

	const handlePointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		onActivate(design.id);
		const { x, y } = svgPoint(e);
		setIsPointerDown(true);
		interactionOriginalRef.current = null;
		createdShapeIdRef.current = null;

		if (tool === "draw-rect") {
			const rect = createRect({ x, y, fill: "#94a3b833" });
			// Add locally for immediate feedback (draft)
			setShapes((prev) => [...prev, rect]);
			setDraftId(rect.id);
			setSelectedId(rect.id);
			setSelectedIds([rect.id]);
			createdShapeIdRef.current = rect.id;
			return;
		}
		if (tool === "draw-ellipse") {
			const ellipse = createEllipse({ x, y, fill: "#22c55e22" });
			setShapes((prev) => [...prev, ellipse]);
			setDraftId(ellipse.id);
			setSelectedId(ellipse.id);
			setSelectedIds([ellipse.id]);
			createdShapeIdRef.current = ellipse.id;
			return;
		}
		if (tool === "draw-line") {
			const line = createLine({ x, y });
			setShapes((prev) => [...prev, line]);
			setDraftId(line.id);
			setSelectedId(line.id);
			setSelectedIds([line.id]);
			createdShapeIdRef.current = line.id;
			return;
		}
		if (tool === "draw-text") {
			const text = createText({ x, y });
			setShapes((prev) => [...prev, text]);
			setSelectedId(text.id);
			setSelectedIds([text.id]);
			setEditingTextId(text.id);
			setTextEditorValue("");
			setTextEditorPos({ left: x, top: y, fontSize: 20 });
			onToolChange("select");
			createdShapeIdRef.current = text.id;
			requestAnimationFrame(() => {
				textEditorRef.current?.focus();
			});
			return;
		}
		if (tool === "draw-pencil") {
			// Check if clicking near an existing path to continue it
			const nearbyPath = findNearbyPath(x, y);
			if (nearbyPath) {
				// Continue existing path - store original for undo
				extendingPathRef.current = {
					...nearbyPath,
					points: [...nearbyPath.points],
				};
				setPencilDraftId(nearbyPath.id);
				// Add new sub-path starting point (moveTo: true creates a discontinuous stroke)
				setShapeById(nearbyPath.id, (s) => {
					if (s.type !== "path") return s;
					return { ...s, points: [...s.points, { x, y, moveTo: true }] };
				});
				return;
			}

			// Create new path
			const id = createShapeId("path");
			const path: PathShape = {
				id,
				type: "path",
				x: 0,
				y: 0,
				points: [{ x, y, moveTo: true }],
				stroke: SHAPE_DEFAULTS.path.stroke,
				strokeWidth: SHAPE_DEFAULTS.path.strokeWidth,
			};
			setShapes((prev) => [...prev, path]);
			setPencilDraftId(id);
			// Don't select until drawing is complete (avoids selection box while drawing)
			createdShapeIdRef.current = id;
			extendingPathRef.current = null;
			return;
		}

		if (tool === "select") {
			setSelectedId(null);
			setSelectedIds([]);
			setMarquee({ x, y, width: 0, height: 0 });
		}

		if (tool === "lasso") {
			// Start lasso on empty canvas (for general context selection)
			setIsLassoing(true);
			setLassoPoints([{ x, y }]);
			setLassoImageId(null); // No specific image target
		}
	};

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		onActivate(design.id);
		setRcOpen(true);
		setRcBusy(false);
		setRcText("");
		setRcSuggestions([]);
		setRcSuggestionsLoading(true);

		// Determine context-aware placeholder
		let placeholderCategory: keyof typeof PLACEHOLDER_EXAMPLES = "none";
		if (selectedIds.length > 1) {
			placeholderCategory = "multiple";
		} else if (selectedId || selectedIds.length === 1) {
			const id = selectedId || selectedIds[0];
			const shape = shapes.find((s) => s.id === id);
			if (shape) {
				if (shape.type === "text") {
					placeholderCategory = "text";
				} else if (shape.type === "image") {
					placeholderCategory = "image";
				} else {
					placeholderCategory = "shape";
				}
			}
		}
		setRcPlaceholder(getRandomPlaceholder(placeholderCategory));
		setRcPos({ left: e.clientX, top: e.clientY });

		// Fetch smart suggestions in background
		void (async () => {
			try {
				// Render visual context for AI
				const context = await renderCanvasContext({
					shapes,
					canvasWidth: design.width,
					canvasHeight: design.height,
					selectedIds:
						selectedIds.length > 0
							? selectedIds
							: selectedId
								? [selectedId]
								: undefined,
				});

				// Build selected shapes info
				const effectiveSelectedIds =
					selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
				const selectedShapesInfo = effectiveSelectedIds
					.map((id) => shapes.find((s) => s.id === id))
					.filter((s): s is NonNullable<typeof s> => s != null)
					.map((s) => ({
						id: s.id,
						type: s.type,
						x: s.x,
						y: s.y,
						width: "width" in s ? s.width : undefined,
						height: "height" in s ? s.height : undefined,
						fill: s.fill,
						stroke: s.stroke,
						text: s.type === "text" ? s.text : undefined,
					}));

				const res = await suggestActions({
					imageContext: context.dataUrl,
					contextDescription: context.description,
					selectedShapes:
						selectedShapesInfo.length > 0 ? selectedShapesInfo : undefined,
				});

				setRcSuggestions(
					res.suggestions.map((s) => ({
						label: s.label,
						command: s.command as CanvasToolCommand,
					})),
				);
			} catch (error) {
				console.error("Failed to fetch suggestions:", error);
				setRcSuggestions([]);
			} finally {
				setRcSuggestionsLoading(false);
			}
		})();
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		if (!isPointerDown) return;
		const { x, y } = svgPoint(e);

		if (isLassoing) {
			setLassoPoints((pts) =>
				pts.length === 0 ||
				Math.abs(pts[pts.length - 1].x - x) +
					Math.abs(pts[pts.length - 1].y - y) >
					1
					? [...pts, { x, y }]
					: pts,
			);
			return;
		}

		if (marquee) {
			setMarquee((m) =>
				m ? { x: m.x, y: m.y, width: x - m.x, height: y - m.y } : m,
			);
			return;
		}

		if (pencilDraftId) {
			setShapeById(pencilDraftId, (s) => {
				if (s.type !== "path") return s;
				const lastPt = s.points[s.points.length - 1];
				// Only add point if moved enough (reduces point count)
				if (
					lastPt &&
					Math.hypot(x - lastPt.x, y - lastPt.y) < SIZES.minPointDistance
				)
					return s;
				return { ...s, points: [...s.points, { x, y }] };
			});
			return;
		}

		if (groupDragRef.current && tool === "select" && selectedIds.length >= 1) {
			const { startX, startY, originals } = groupDragRef.current;
			const dx = x - startX;
			const dy = y - startY;
			setShapes((prev) =>
				prev.map((s) => {
					if (!selectedIds.includes(s.id)) return s;
					const original = originals[s.id];
					if (!original) return s;
					return moveShape(original, dx, dy);
				}),
			);
			return;
		}

		if (draftId) {
			setShapeById(draftId, (s) => {
				if (s.type === "rect" || s.type === "ellipse") {
					const originX = s.x;
					const originY = s.y;
					const newX = Math.min(originX, x);
					const newY = Math.min(originY, y);
					const newW = Math.abs(x - originX);
					const newH = Math.abs(y - originY);
					return { ...s, x: newX, y: newY, width: newW, height: newH };
				}
				if (s.type === "line") {
					return { ...s, x2: x, y2: y };
				}
				return s;
			});
			return;
		}

		if (tool === "select" && selectedId && activeHandle) {
			const preserveAspectRatio = !e.shiftKey;
			setShapeById(selectedId, (s) => {
				if (activeHandle.kind === "corner") {
					const corner = activeHandle.corner as Corner;
					const orig = interactionOriginalRef.current;

					if (
						s.type === "rect" ||
						s.type === "ellipse" ||
						s.type === "image" ||
						s.type === "svg"
					) {
						const origBounds =
							orig && "width" in orig
								? {
										x: orig.x,
										y: orig.y,
										width: orig.width,
										height: orig.height,
									}
								: { x: s.x, y: s.y, width: s.width, height: s.height };
						return resizeRectShape(
							s,
							origBounds,
							corner,
							x,
							y,
							preserveAspectRatio,
						);
					}

					if (s.type === "path") {
						if (!orig || orig.type !== "path" || orig.points.length === 0)
							return s;
						return resizePathShape(
							s,
							orig.points,
							corner,
							x,
							y,
							preserveAspectRatio,
						);
					}
				}

				if (s.type === "line" && activeHandle.kind === "line-end") {
					if (activeHandle.end === 1) return { ...s, x, y };
					return { ...s, x2: x, y2: y };
				}

				return s;
			});
		}
	};

	const handlePointerUp = () => {
		setIsPointerDown(false);
		setActiveHandle(null);

		// Commit group drag as operations
		// Note: Shapes are already in final position from handlePointerMove
		// We only need to create operations for persistence and undo
		if (groupDragRef.current) {
			const originals = groupDragRef.current.originals;
			for (const [id, originalShape] of Object.entries(originals)) {
				const currentShape = shapes.find((s) => s.id === id);
				if (currentShape && originalShape) {
					const { updates, previousValues } = getShapeChanges(
						originalShape,
						currentShape,
					);
					if (Object.keys(updates).length > 0) {
						const op = createUpdateShapeOp(
							clientId,
							id,
							updates,
							previousValues,
						);
						// Don't apply locally - shapes are already positioned
						// Just add to undo stack and queue for server
						setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
						pendingOpsRef.current.push(op);
					}
				}
			}
			scheduleFlush();
			groupDragRef.current = null;
		}

		if (marquee) {
			const norm = normalizeRect(marquee);
			const ids = shapes
				.filter((s) => rectsIntersect(getShapeBounds(s), norm))
				.map((s) => s.id);
			setSelectedIds(ids);
			setSelectedId(ids[ids.length - 1] ?? null);
			setMarquee(null);
		}

		if (isLassoing) {
			setIsLassoing(false);
			if (lassoPoints.length > 2) {
				// Store lasso state - imageId is null for general context, string for image edit
				setLassoPending({ imageId: lassoImageId, points: lassoPoints });
				setRcText("");
				setRcPlaceholder(
					lassoImageId
						? "Describe edit for selected region…"
						: "Describe what to do with this area…",
				);
				const center = centroid(lassoPoints);
				const pos = screenPointFromSvg(center.x, center.y);
				setRcPos({ left: pos.left + 8, top: pos.top + 8 });
				setRcOpen(true);
			}
			setLassoImageId(null);
			setLassoPoints([]);
		}

		// Commit pencil path as operation
		if (pencilDraftId) {
			const draft = shapes.find((s) => s.id === pencilDraftId);
			if (draft && draft.type === "path") {
				if (extendingPathRef.current) {
					// We were extending an existing path - create update operation
					const original = extendingPathRef.current;
					const { updates, previousValues } = getShapeChanges(original, draft);
					if (Object.keys(updates).length > 0) {
						const op = createUpdateShapeOp(
							clientId,
							draft.id,
							updates,
							previousValues,
						);
						setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
						pendingOpsRef.current.push(op);
						scheduleFlush();
					}
					// Select the path
					setSelectedId(pencilDraftId);
					setSelectedIds([pencilDraftId]);
					extendingPathRef.current = null;
				} else if (draft.points.length >= 1) {
					// Valid new path (even single point for dots) - commit as add operation
					const op = createAddShapeOp(clientId, draft);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
					// Now select the completed path
					setSelectedId(pencilDraftId);
					setSelectedIds([pencilDraftId]);
				} else {
					// No points at all - remove
					removeShapeById(pencilDraftId);
					setSelectedId(null);
					setSelectedIds([]);
				}
			}
			setPencilDraftId(null);
			extendingPathRef.current = null; // Always clear this
			// Stay in pencil mode to allow continued drawing
		}

		// Commit draft shape as operation
		if (draftId) {
			const draft = shapes.find((s) => s.id === draftId);
			if (draft) {
				if (
					(draft.type === "rect" || draft.type === "ellipse") &&
					(draft.width < 2 || draft.height < 2)
				) {
					// Too small, remove without committing
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else if (
					draft.type === "line" &&
					Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y) < 2
				) {
					// Too small, remove without committing
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else {
					// Valid shape - commit as operation
					// The shape is already in local state, so we just need to send the operation
					// and add to undo stack
					const op = createAddShapeOp(clientId, draft);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
				}
			}
			setDraftId(null);
			if (
				tool === "draw-rect" ||
				tool === "draw-ellipse" ||
				tool === "draw-line"
			) {
				onToolChange("select");
			}
		}

		// Commit resize as operation
		if (!draftId && interactionOriginalRef.current) {
			const original = interactionOriginalRef.current;
			const current = shapes.find((s) => s.id === original.id);
			if (current) {
				const { updates, previousValues } = getShapeChanges(original, current);
				if (Object.keys(updates).length > 0) {
					const op = createUpdateShapeOp(
						clientId,
						original.id,
						updates,
						previousValues,
					);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
				}
			}
		}
		interactionOriginalRef.current = null;
		createdShapeIdRef.current = null;
	};

	const runLassoEdit = useCallback(
		async (
			imageId: string,
			points: Array<{ x: number; y: number }>,
			prompt: string,
		) => {
			setIsProcessing(true);
			try {
				await externalRunLassoEdit(imageId, points, prompt, {
					shapes,
					setShapes,
					setUndoStack: () => {}, // Undo handled differently now
					editCanvasImage,
				});
			} finally {
				setIsProcessing(false);
			}
		},
		[shapes, editCanvasImage],
	);

	const onShapePointerDown = (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: "move" | { resize: "nw" | "ne" | "sw" | "se" } | { lineEnd: 1 | 2 },
	) => {
		e.stopPropagation();
		if (e.button !== 0) return;
		onActivate(design.id);
		const { x, y } = svgPoint(e);

		// Handle pencil tool - extend path when clicking on any shape
		if (tool === "draw-pencil") {
			setIsPointerDown(true);
			// Find a path to extend (prioritize the clicked shape if it's a path)
			const targetPath =
				shape.type === "path" ? (shape as PathShape) : findNearbyPath(x, y);
			if (targetPath) {
				// Continue existing path with a new sub-path
				extendingPathRef.current = {
					...targetPath,
					points: [...targetPath.points],
				};
				setPencilDraftId(targetPath.id);
				setShapeById(targetPath.id, (s) => {
					if (s.type !== "path") return s;
					return { ...s, points: [...s.points, { x, y, moveTo: true }] };
				});
			} else {
				// Create new path
				const id = createShapeId("path");
				const path: PathShape = {
					id,
					type: "path",
					x: 0,
					y: 0,
					points: [{ x, y, moveTo: true }],
					stroke: SHAPE_DEFAULTS.path.stroke,
					strokeWidth: SHAPE_DEFAULTS.path.strokeWidth,
				};
				setShapes((prev) => [...prev, path]);
				setPencilDraftId(id);
				createdShapeIdRef.current = id;
				extendingPathRef.current = null;
			}
			return;
		}

		setIsPointerDown(true);
		if (!selectedIds.includes(shape.id)) {
			setSelectedIds([shape.id]);
		}
		setSelectedId(shape.id);
		interactionOriginalRef.current = JSON.parse(
			JSON.stringify(shape),
		) as CanvasShape;

		if (tool === "lasso" && shape.type === "image") {
			setIsLassoing(true);
			setLassoPoints([{ x, y }]);
			setLassoImageId(shape.id);
			return;
		}
		if (mode === "move") {
			if (tool === "select") {
				const currentSelection = selectedIds.includes(shape.id)
					? selectedIds
					: [shape.id];
				const originals: Record<string, CanvasShape> = {};
				for (const id of currentSelection) {
					const s = shapes.find((sh) => sh.id === id);
					if (s) originals[id] = JSON.parse(JSON.stringify(s)) as CanvasShape;
				}
				groupDragRef.current = { startX: x, startY: y, originals };
				return;
			}
		}
		if (typeof mode === "object" && "resize" in mode) {
			setActiveHandle({ kind: "corner", corner: mode.resize });
			return;
		}
		if (typeof mode === "object" && "lineEnd" in mode) {
			setActiveHandle({ kind: "line-end", end: mode.lineEnd });
			return;
		}
	};

	const commitTextEdit = useCallback(() => {
		if (!editingTextId) return;
		const value = textEditorValue.trim();
		const currentShape = shapes.find((s) => s.id === editingTextId);

		if (value.length === 0) {
			// Empty text - don't commit, just remove locally
			removeShapeById(editingTextId);
			setSelectedId(null);
		} else if (currentShape) {
			// Update text and commit as operation
			const updatedShape = { ...currentShape, text: value } as CanvasShape;
			setShapeById(editingTextId, () => updatedShape);

			// If this was a new shape, commit as add
			if (createdShapeIdRef.current === editingTextId) {
				const op = createAddShapeOp(clientId, updatedShape);
				setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
				pendingOpsRef.current.push(op);
				scheduleFlush();
				createdShapeIdRef.current = null;
			} else {
				// Existing shape, commit as update
				updateShapeOp(editingTextId, currentShape, {
					text: value,
				} as Partial<CanvasShape>);
			}
		}
		setEditingTextId(null);
		setTextEditorValue("");
	}, [
		editingTextId,
		textEditorValue,
		shapes,
		removeShapeById,
		setShapeById,
		clientId,
		scheduleFlush,
		updateShapeOp,
	]);

	const cancelTextEdit = useCallback(() => {
		if (editingTextId && createdShapeIdRef.current === editingTextId) {
			// Was a new shape, remove it
			removeShapeById(editingTextId);
			setSelectedId(null);
			createdShapeIdRef.current = null;
		}
		setEditingTextId(null);
		setTextEditorValue("");
	}, [editingTextId, removeShapeById]);

	// Calculate scale to fit canvas in container
	const containerPadding = 40;
	const maxWidth = 800;
	const maxHeight = 600;
	const scale = Math.min(
		(maxWidth - containerPadding) / design.width,
		(maxHeight - containerPadding) / design.height,
		1,
	);
	const displayWidth = design.width * scale;
	const displayHeight = design.height * scale;

	// Cleanup on unmount - flush any pending operations
	useEffect(() => {
		return () => {
			if (flushTimeoutRef.current) {
				clearTimeout(flushTimeoutRef.current);
			}
			// Synchronously flush pending operations before unmount
			// This ensures no operations are lost when navigating away
			if (pendingOpsRef.current.length > 0) {
				void flushPendingOps();
			}
		};
	}, [flushPendingOps]);

	// Register undo method with parent
	useEffect(() => {
		registerUndo?.(design.id, undo);
	}, [design.id, undo, registerUndo]);

	return (
		<div className="flex-shrink-0">
			<div className="mb-2 flex items-center gap-2">
				<span className="text-sm font-medium text-slate-700 dark:text-slate-300">
					{design.name}
				</span>
				<span className="text-xs text-slate-500">
					{design.width} × {design.height}
				</span>
			</div>
			<button
				type="button"
				className={`relative bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden block text-left ${
					isActive ? "ring-2 ring-violet-500" : "opacity-60"
				}`}
				style={{
					width: displayWidth + containerPadding,
					height: displayHeight + containerPadding,
				}}
				onClick={() => onActivate(design.id)}
			>
				{/* Loading spinner - top right corner */}
				{isProcessing && (
					<div className="absolute right-3 top-3 z-30 flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-lg border border-slate-200 dark:border-slate-700">
						<svg
							className="animate-spin h-4 w-4 text-violet-600"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
						>
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						<span className="text-xs font-medium text-slate-700 dark:text-slate-300">
							Generating...
						</span>
					</div>
				)}

				{isActive && !isProcessing && (
					<div className="absolute right-2 top-2 z-20">
						<PropertiesPanel
							selectedShape={selectedShape}
							setShapeById={(id, updater) => {
								const currentShape = shapes.find((s) => s.id === id);
								if (!currentShape) return;
								const updatedShape = updater(currentShape);
								// Create update operation
								const { updates, previousValues } = getShapeChanges(
									currentShape,
									updatedShape,
								);
								if (Object.keys(updates).length > 0) {
									setShapeById(id, () => updatedShape);
									const op = createUpdateShapeOp(
										clientId,
										id,
										updates,
										previousValues,
									);
									setUndoStack((prev) => [
										...prev,
										invertOperation(clientId, op),
									]);
									pendingOpsRef.current.push(op);
									scheduleFlush();
								}
							}}
							setUndoSnapshot={() => {
								// No longer needed - undo handled by operations
							}}
						/>
					</div>
				)}

				<svg
					ref={svgRef}
					width={displayWidth}
					height={displayHeight}
					viewBox={`0 0 ${design.width} ${design.height}`}
					className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none cursor-crosshair shadow-lg"
					style={{ background: "white" }}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onContextMenu={handleContextMenu}
					onDragOver={(e) => {
						e.preventDefault();
						e.dataTransfer.dropEffect = "copy";
					}}
					onDrop={(e) => {
						e.preventDefault();
						const files = Array.from(e.dataTransfer.files || []);
						if (files.length === 0) return;
						const { x, y } = svgPointFromScreen(e.clientX, e.clientY);
						for (const file of files) {
							if (!file.type.startsWith("image/")) continue;
							void (async () => {
								try {
									const {
										dataUrl,
										width: imgW,
										height: imgH,
									} = await readImageFile(file);
									// Upload to Convex storage
									const { storageUrl } = await uploadImage({ dataUrl });
									const id = createShapeId("img");
									const newShape: ImageShape = {
										id,
										type: "image",
										x,
										y,
										width: Math.min(imgW, 512),
										height: Math.min(imgH, 512),
										href: storageUrl, // Use storage URL instead of base64
									};
									addShapeOp(newShape);
									setSelectedId(id);
									setSelectedIds([id]);
								} catch (err) {
									console.error("Failed to upload dropped image:", err);
								}
							})();
						}
					}}
				>
					<title>Canvas</title>
					<defs>
						<pattern
							id={`checker-${design.id}`}
							patternUnits="userSpaceOnUse"
							width="20"
							height="20"
						>
							<rect x="0" y="0" width="20" height="20" fill="#ffffff" />
							<path
								d="M20 0 H0 V20"
								fill="none"
								stroke="#f1f5f9"
								strokeWidth="1"
							/>
						</pattern>
					</defs>
					<rect
						x={0}
						y={0}
						width={design.width}
						height={design.height}
						fill={`url(#checker-${design.id})`}
					/>

					{shapes.map((s) => (
						<ShapeView
							key={s.id}
							shape={s}
							selected={selectedIds.includes(s.id)}
							onPointerDown={onShapePointerDown}
							tool={tool}
						/>
					))}

					{isLassoing && lassoPoints.length > 1 && (
						<polyline
							points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
							fill="none"
							stroke="#0ea5e9"
							strokeWidth={1.5}
						/>
					)}

					{marquee && (
						<rect
							x={Math.min(marquee.x, marquee.x + marquee.width)}
							y={Math.min(marquee.y, marquee.y + marquee.height)}
							width={Math.abs(marquee.width)}
							height={Math.abs(marquee.height)}
							fill="#60a5fa22"
							stroke="#3b82f6"
							strokeDasharray="4 2"
							strokeWidth={1}
						/>
					)}
				</svg>

				{editingTextId && (
					<textarea
						ref={textEditorRef}
						style={{
							position: "absolute",
							left: textEditorPos.left * scale + containerPadding / 2,
							top: textEditorPos.top * scale + containerPadding / 2,
							fontSize: textEditorPos.fontSize * scale,
							lineHeight: `${textEditorPos.fontSize * 1.2 * scale}px`,
							background: "transparent",
							color: "#0f172a",
							outline: "none",
							border: "1px dashed #94a3b8",
							padding: 2,
							whiteSpace: "pre",
						}}
						value={textEditorValue}
						onChange={(e) => setTextEditorValue(e.target.value)}
						onBlur={commitTextEdit}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								commitTextEdit();
							} else if (e.key === "Escape") {
								e.preventDefault();
								cancelTextEdit();
							}
						}}
					/>
				)}
			</button>

			{/* Right-click command prompt */}
			{rcOpen &&
				createPortal(
					<div
						style={{
							position: "fixed",
							left: rcPos.left + 8,
							top: rcPos.top + 8,
							zIndex: 1000,
						}}
						className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md p-2 shadow-lg w-72"
					>
						<div className="text-xs opacity-70 mb-1">What should I do?</div>
						{/* Smart suggestions */}
						{(rcSuggestionsLoading || rcSuggestions.length > 0) && (
							<div className="mb-2">
								{rcSuggestionsLoading ? (
									<div className="flex flex-wrap gap-1">
										{[1, 2, 3, 4, 5].map((i) => (
											<div
												key={i}
												className="h-6 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"
												style={{ width: `${60 + Math.random() * 40}px` }}
											/>
										))}
									</div>
								) : (
									<div className="flex flex-wrap gap-1">
										{rcSuggestions.map((suggestion, i) => (
											<button
												type="button"
												key={i}
												className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
												disabled={rcBusy}
												onClick={() => {
													if (rcBusy) return;
													setRcBusy(true);
													setIsProcessing(true);
													void (async () => {
														try {
															const context = await renderCanvasContext({
																shapes,
																canvasWidth: design.width,
																canvasHeight: design.height,
																selectedIds:
																	selectedIds.length > 0
																		? selectedIds
																		: selectedId
																			? [selectedId]
																			: undefined,
															});
															await applyCommandGroup(
																[suggestion.command],
																{ recordUndo: true },
																{
																	userPrompt: suggestion.label,
																	canvasDataUrl: context.dataUrl,
																},
															);
															setRcOpen(false);
														} catch (error) {
															console.error(
																"Failed to apply suggestion:",
																error,
															);
														} finally {
															setRcBusy(false);
															setIsProcessing(false);
														}
													})();
												}}
											>
												{suggestion.label}
											</button>
										))}
									</div>
								)}
							</div>
						)}
						<Input
							placeholder={rcPlaceholder}
							value={rcText}
							onChange={(e) => setRcText(e.target.value)}
							autoFocus
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									if (!rcText.trim() || rcBusy) return;
									setRcBusy(true);
									setIsProcessing(true);
									void (async () => {
										if (lassoPending?.imageId) {
											// Image-specific lasso edit
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}

										// Render visual context for AI
										// Use lasso points for context if available, otherwise selection
										const context = await renderCanvasContext({
											shapes,
											canvasWidth: design.width,
											canvasHeight: design.height,
											selectedIds:
												!lassoPending && selectedIds.length > 0
													? selectedIds
													: !lassoPending && selectedId
														? [selectedId]
														: undefined,
											lassoPoints: lassoPending?.points,
										});

										// Build selected shapes info for multi-element operations
										const effectiveSelectedIds =
											!lassoPending && selectedIds.length > 0
												? selectedIds
												: !lassoPending && selectedId
													? [selectedId]
													: [];
										const selectedShapesInfo = effectiveSelectedIds
											.map((id) => shapes.find((s) => s.id === id))
											.filter((s): s is NonNullable<typeof s> => s != null)
											.map((s) => ({
												id: s.id,
												type: s.type,
												x: s.x,
												y: s.y,
												width: "width" in s ? s.width : undefined,
												height: "height" in s ? s.height : undefined,
												fill: s.fill,
												stroke: s.stroke,
												text: s.type === "text" ? s.text : undefined,
											}));

										const res = await interpret({
											input: rcText.trim(),
											imageContext: context.dataUrl,
											contextDescription: context.description,
											selectedShapes:
												selectedShapesInfo.length > 0
													? selectedShapesInfo
													: undefined,
										});
										await applyCommandGroup(
											res.commands,
											{ recordUndo: true },
											{
												userPrompt: rcText.trim(),
												canvasDataUrl: context.dataUrl,
											},
										);
										setLassoPending(null);
										setRcOpen(false);
									})()
										.catch(() => {})
										.finally(() => {
											setRcBusy(false);
											setIsProcessing(false);
										});
								}
								if (e.key === "Escape") {
									setLassoPending(null);
									setRcOpen(false);
								}
							}}
						/>
						<div className="mt-2 flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setRcOpen(false)}
							>
								Cancel
							</Button>
							<Button
								disabled={rcBusy || !rcText.trim()}
								size="sm"
								onClick={() => {
									if (!rcText.trim() || rcBusy) return;
									setRcBusy(true);
									setIsProcessing(true);
									void (async () => {
										if (lassoPending?.imageId) {
											// Image-specific lasso edit
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}

										// Render visual context for AI
										// Use lasso points for context if available, otherwise selection
										const context = await renderCanvasContext({
											shapes,
											canvasWidth: design.width,
											canvasHeight: design.height,
											selectedIds:
												!lassoPending && selectedIds.length > 0
													? selectedIds
													: !lassoPending && selectedId
														? [selectedId]
														: undefined,
											lassoPoints: lassoPending?.points,
										});

										// Build selected shapes info for multi-element operations
										const effectiveSelectedIds =
											!lassoPending && selectedIds.length > 0
												? selectedIds
												: !lassoPending && selectedId
													? [selectedId]
													: [];
										const selectedShapesInfo = effectiveSelectedIds
											.map((id) => shapes.find((s) => s.id === id))
											.filter((s): s is NonNullable<typeof s> => s != null)
											.map((s) => ({
												id: s.id,
												type: s.type,
												x: s.x,
												y: s.y,
												width: "width" in s ? s.width : undefined,
												height: "height" in s ? s.height : undefined,
												fill: s.fill,
												stroke: s.stroke,
												text: s.type === "text" ? s.text : undefined,
											}));

										const res = await interpret({
											input: rcText.trim(),
											imageContext: context.dataUrl,
											contextDescription: context.description,
											selectedShapes:
												selectedShapesInfo.length > 0
													? selectedShapesInfo
													: undefined,
										});
										await applyCommandGroup(
											res.commands,
											{ recordUndo: true },
											{
												userPrompt: rcText.trim(),
												canvasDataUrl: context.dataUrl,
											},
										);
										setLassoPending(null);
										setRcOpen(false);
									})()
										.catch(() => {})
										.finally(() => {
											setRcBusy(false);
											setIsProcessing(false);
										});
								}}
							>
								{rcBusy ? "Working…" : "Run"}
							</Button>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

export const DesignCanvas = forwardRef<DesignCanvasRef, DesignCanvasProps>(
	function DesignCanvas(
		{
			designs,
			activeDesignId,
			onActivate,
			tool,
			onToolChange,
			onUndoStackChange,
			onSelectionChange,
		},
		ref,
	) {
		// Shared client ID for all canvases
		const clientIdRef = useRef<string>(generateClientId());

		// Store shapes per design for retrieval
		const shapesMapRef = useRef<Map<string, CanvasShape[]>>(new Map());

		// Store undo functions per design
		const undoFunctionsRef = useRef<Map<string, () => boolean>>(new Map());

		// Store layer operations per design
		const layerOpsRef = useRef<
			Map<
				string,
				{
					moveUp: () => void;
					moveDown: () => void;
					deleteSelection: () => void;
					hasSelection: () => boolean;
				}
			>
		>(new Map());

		// Track which design can undo - using ref for synchronous comparison to prevent infinite loops
		const canUndoMapRef = useRef<Map<string, boolean>>(new Map());
		const [canUndoMap, setCanUndoMap] = useState<Map<string, boolean>>(
			new Map(),
		);

		// Expose ref methods
		useImperativeHandle(ref, () => ({
			getShapes: (designId: string) => {
				return shapesMapRef.current.get(designId) ?? [];
			},
			undo: () => {
				if (!activeDesignId) return;
				const undoFn = undoFunctionsRef.current.get(activeDesignId);
				if (undoFn) undoFn();
			},
			resetView: () => {
				// Reset view - could clear selection
			},
			canUndo: () => {
				if (!activeDesignId) return false;
				return canUndoMap.get(activeDesignId) ?? false;
			},
			hasSelection: () => {
				if (!activeDesignId) return false;
				const ops = layerOpsRef.current.get(activeDesignId);
				return ops?.hasSelection() ?? false;
			},
			moveSelectionUp: () => {
				if (!activeDesignId) return;
				const ops = layerOpsRef.current.get(activeDesignId);
				ops?.moveUp();
			},
			moveSelectionDown: () => {
				if (!activeDesignId) return;
				const ops = layerOpsRef.current.get(activeDesignId);
				ops?.moveDown();
			},
			deleteSelection: () => {
				if (!activeDesignId) return;
				const ops = layerOpsRef.current.get(activeDesignId);
				ops?.deleteSelection();
			},
		}));

		const handleCanUndoChange = useCallback(
			(designId: string, canUndo: boolean) => {
				// Use ref for synchronous comparison to prevent infinite loops
				// The ref is checked BEFORE any state updates or parent callbacks
				if (canUndoMapRef.current.get(designId) === canUndo) {
					return; // No change - skip state update and parent callback entirely
				}

				// Update ref synchronously
				canUndoMapRef.current.set(designId, canUndo);

				// Update state for React rendering
				setCanUndoMap(new Map(canUndoMapRef.current));

				// Notify parent - only called when value actually changed
				onUndoStackChange?.(designId, canUndo);
			},
			[onUndoStackChange],
		);

		// Stable callback for registering undo functions
		const handleRegisterUndo = useCallback(
			(designId: string, undoFn: () => boolean) => {
				undoFunctionsRef.current.set(designId, undoFn);
			},
			[],
		);

		// Stable callback for registering layer operations
		const handleRegisterLayerOps = useCallback(
			(
				designId: string,
				ops: {
					moveUp: () => void;
					moveDown: () => void;
					deleteSelection: () => void;
					hasSelection: () => boolean;
				},
			) => {
				layerOpsRef.current.set(designId, ops);
			},
			[],
		);

		return (
			<div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
				<div className="flex gap-6 min-w-min">
					{designs.map((design) => (
						<SingleDesignCanvas
							key={design.id}
							design={design}
							isActive={activeDesignId === design.id}
							onActivate={onActivate}
							tool={tool}
							onToolChange={onToolChange}
							clientId={clientIdRef.current}
							onCanUndoChange={handleCanUndoChange}
							registerUndo={handleRegisterUndo}
							onSelectionChange={onSelectionChange}
							registerLayerOps={handleRegisterLayerOps}
						/>
					))}
				</div>
			</div>
		);
	},
);
